// SmokeRasterizer.cs
// Scales the premultiplied smoke sprite into independent screen-row ranges.

using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace SlopGrenadeDesktop
{
    internal sealed class SmokeRasterizer
    {
        private readonly int _width, _height;
        private readonly int[] _x0, _x1, _weightX;
        private readonly ParallelOptions _parallel;
        private int[] _pixels;
        private SmokeField _source;
        private int _version;
        private RectangleF _destination;

        public readonly int WorkerCount;
        public Rectangle Bounds { get; private set; }
        public bool Ready { get; private set; }

        public SmokeRasterizer(int width, int height, int requestedWorkers = 4)
        {
            if (width < 1) throw new ArgumentOutOfRangeException("width");
            if (height < 1) throw new ArgumentOutOfRangeException("height");
            if (requestedWorkers < 1) throw new ArgumentOutOfRangeException("requestedWorkers");
            _width = width;
            _height = height;
            WorkerCount = Math.Min(requestedWorkers, Environment.ProcessorCount);
            _parallel = new ParallelOptions { MaxDegreeOfParallelism = WorkerCount };
            _x0 = new int[width];
            _x1 = new int[width];
            _weightX = new int[width];
        }

        private static int Flip(int position, int length)
        {
            int period = length * 2;
            int value = position % period;
            if (value < 0) value += period;
            return value < length ? value : period - value - 1;
        }

        public void Prepare(SmokeField smoke, RectangleF destination)
        {
            if (smoke == null) throw new ArgumentNullException("smoke");
            if (smoke.IsEmpty || smoke.Bx1 < smoke.Bx0)
            {
                Ready = false;
                Bounds = Rectangle.Empty;
                _pixels = null;
                _source = null;
                return;
            }
            if (Ready && _source == smoke && _version == smoke.RenderVersion && _destination == destination) return;
            Ready = false;
            Rectangle dest = Rectangle.Round(destination);
            Rectangle bounds = Rectangle.Intersect(dest, new Rectangle(0, 0, _width, _height));
            if (dest.Width <= 0 || dest.Height <= 0 || bounds.Width <= 0 || bounds.Height <= 0)
            {
                Bounds = Rectangle.Empty;
                _source = null;
                return;
            }

            int required = checked(bounds.Width * bounds.Height);
            if (_pixels == null || _pixels.Length < required)
            {
                int screenPixels = checked(_width * _height);
                int capacity = _pixels == null ? Math.Min(4096, screenPixels) : _pixels.Length;
                while (capacity < required)
                    capacity = capacity > screenPixels / 2 ? screenPixels : capacity * 2;
                _pixels = new int[capacity];
            }
            int sourceWidth = smoke.Sprite.Width, sourceHeight = smoke.Sprite.Height;
            float scaleX = (float)sourceWidth / _width, scaleY = (float)sourceHeight / _height;
            float sourceX = destination.X * scaleX, sourceY = destination.Y * scaleY;
            float sourceW = destination.Width * scaleX, sourceH = destination.Height * scaleY;
            // Match GDI+'s half-pixel bilinear sampling of premultiplied pixels.
            for (int x = bounds.Left; x < bounds.Right; x++)
            {
                float coordinate = sourceX + ((x + 0.5f - dest.X) / dest.Width) * sourceW - 0.5f;
                int left = (int)Math.Floor(coordinate);
                _x0[x] = Flip(left, sourceWidth);
                _x1[x] = Flip(left + 1, sourceWidth);
                _weightX[x] = (int)((coordinate - left) * 256f);
            }
            Action<int> draw = delegate(int worker)
            {
                int top = bounds.Top + bounds.Height * worker / WorkerCount;
                int bottom = bounds.Top + bounds.Height * (worker + 1) / WorkerCount;
                for (int y = top; y < bottom; y++)
                {
                    float coordinate = sourceY + ((y + 0.5f - dest.Y) / dest.Height) * sourceH - 0.5f;
                    int row = (int)Math.Floor(coordinate);
                    int y0 = Flip(row, sourceHeight) * sourceWidth, y1 = Flip(row + 1, sourceHeight) * sourceWidth;
                    int wy = (int)((coordinate - row) * 256f), iy = 256 - wy;
                    int outRow = (y - bounds.Top) * bounds.Width;
                    for (int x = bounds.Left; x < bounds.Right; x++)
                    {
                        int wx = _weightX[x], ix = 256 - wx;
                        int a = smoke.Sprite.Pixels[y0 + _x0[x]], b = smoke.Sprite.Pixels[y0 + _x1[x]];
                        int c = smoke.Sprite.Pixels[y1 + _x0[x]], d = smoke.Sprite.Pixels[y1 + _x1[x]];
                        int result = 0;
                        for (int channel = 0; channel < 4; channel++)
                        {
                            int shift = channel * 8;
                            int value = (((a >> shift) & 255) * ix + ((b >> shift) & 255) * wx) * iy
                                + (((c >> shift) & 255) * ix + ((d >> shift) & 255) * wx) * wy;
                            result |= ((value + 32768) >> 16) << shift;
                        }
                        _pixels[outRow + x - bounds.Left] = result;
                    }
                }
            };
            if (WorkerCount == 1 || required < 32768)
            {
                for (int i = 0; i < WorkerCount; i++) draw(i);
            }
            else Parallel.For(0, WorkerCount, _parallel, draw);
            Bounds = bounds;
            _source = smoke;
            _version = smoke.RenderVersion;
            _destination = destination;
            Ready = true;
        }

        public void CopyTo(IntPtr destination, int stride, Rectangle clip)
        {
            if (destination == IntPtr.Zero) throw new ArgumentException("Destination must be allocated.", "destination");
            if (stride < _width * 4) throw new ArgumentOutOfRangeException("stride");
            if (!Ready) return;
            Rectangle area = Rectangle.Intersect(Bounds, clip);
            if (area.Width <= 0 || area.Height <= 0) return;
            for (int y = area.Top; y < area.Bottom; y++)
            {
                int source = (y - Bounds.Top) * Bounds.Width + area.Left - Bounds.Left;
                int offset = checked(y * stride + area.Left * 4);
                Marshal.Copy(_pixels, source, IntPtr.Add(destination, offset), area.Width);
            }
        }
    }
}
