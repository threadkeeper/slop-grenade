// PixelSprite.cs
// A premultiplied-ARGB pixel buffer that GDI+ can draw directly (pinned int[]).

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace SlopGrenadeDesktop
{
    internal sealed class PixelSprite : IDisposable
    {
        public readonly int Width;
        public readonly int Height;
        public readonly int[] Pixels;
        public readonly Bitmap Bitmap;
        private GCHandle _handle;

        public PixelSprite(int width, int height)
        {
            Width = Math.Max(1, width);
            Height = Math.Max(1, height);
            Pixels = new int[Width * Height];
            _handle = GCHandle.Alloc(Pixels, GCHandleType.Pinned);
            Bitmap = new Bitmap(Width, Height, Width * 4, PixelFormat.Format32bppPArgb, _handle.AddrOfPinnedObject());
        }

        public void Clear()
        {
            Array.Clear(Pixels, 0, Pixels.Length);
        }

        public void Dispose()
        {
            Bitmap.Dispose();
            if (_handle.IsAllocated) _handle.Free();
        }
    }
}
