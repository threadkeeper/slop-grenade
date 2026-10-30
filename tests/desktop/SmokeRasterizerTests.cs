using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Reflection;
using System.Runtime.InteropServices;

namespace SlopGrenadeDesktop
{
    internal static class SmokeRasterizerTests
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        public static void MatchesGdi()
        {
            foreach (Size size in new[] { new Size(641, 359), new Size(1920, 1200) })
            {
                using (SmokeField smoke = new SmokeField(size.Width, size.Height, 45))
                using (PixelSprite reference = new PixelSprite(size.Width, size.Height))
                using (Graphics graphics = Graphics.FromImage(reference.Bitmap))
                using (ImageAttributes attributes = new ImageAttributes())
                {
                    for (int i = 0; i < 7; i++)
                        smoke.Puff(i * size.Width / 6f, size.Height * (0.25f + 0.1f * (i % 5)),
                            size.Height * 0.08f, 1.4f, 10f, -20f, i / 7f);
                    for (int i = 0; i < 15; i++) smoke.Step(1f / 30f);
                    smoke.Render();
                    float sx = (float)size.Width / smoke.Sprite.Width, sy = (float)size.Height / smoke.Sprite.Height;
                    RectangleF destination = RectangleF.FromLTRB((smoke.Bx0 - 2) * sx, (smoke.By0 - 2) * sy,
                        (smoke.Bx1 + 3) * sx, (smoke.By1 + 3) * sy);
                    graphics.InterpolationMode = InterpolationMode.Bilinear;
                    graphics.PixelOffsetMode = PixelOffsetMode.Half;
                    attributes.SetWrapMode(WrapMode.TileFlipXY);
                    graphics.Clear(Color.Transparent);
                    graphics.DrawImage(smoke.Sprite.Bitmap, Rectangle.Round(destination), destination.X / sx, destination.Y / sy,
                        destination.Width / sx, destination.Height / sy, GraphicsUnit.Pixel, attributes);
                    graphics.Flush(FlushIntention.Sync);

                    SmokeRasterizer serial = new SmokeRasterizer(size.Width, size.Height, 1);
                    SmokeRasterizer parallel = new SmokeRasterizer(size.Width, size.Height, 4);
                    serial.Prepare(smoke, destination);
                    parallel.Prepare(smoke, destination);
                    Check(serial.Ready && parallel.Ready && parallel.WorkerCount <= Environment.ProcessorCount,
                        "A visible smoke field must produce a bounded-worker raster.");
                    FieldInfo bufferField = typeof(SmokeRasterizer).GetField("_pixels", BindingFlags.Instance | BindingFlags.NonPublic);
                    int[] buffer = (int[])bufferField.GetValue(parallel);
                    Check(buffer.Length >= parallel.Bounds.Width * parallel.Bounds.Height && buffer.Length <= size.Width * size.Height,
                        "The reusable buffer must be large enough for the smoke and no larger than the screen.");
                    parallel.Prepare(smoke, destination);
                    Check(ReferenceEquals(buffer, bufferField.GetValue(parallel)), "Unchanged smoke must reuse its cached raster.");
                    int[] first = new int[size.Width * size.Height], second = new int[first.Length];
                    for (int i = 0; i < first.Length; i++) first[i] = second[i] = unchecked((int)0xff010203);
                    GCHandle a = GCHandle.Alloc(first, GCHandleType.Pinned);
                    GCHandle b = GCHandle.Alloc(second, GCHandleType.Pinned);
                    Rectangle clip = new Rectangle(size.Width / 7, size.Height / 9, size.Width * 5 / 7, size.Height * 7 / 9);
                    try
                    {
                        serial.CopyTo(a.AddrOfPinnedObject(), size.Width * 4, clip);
                        parallel.CopyTo(b.AddrOfPinnedObject(), size.Width * 4, clip);
                    }

                    finally { a.Free(); b.Free(); }
                    for (int y = 0; y < size.Height; y++)
                        for (int x = 0; x < size.Width; x++)
                        {
                            int i = y * size.Width + x;
                            Check(first[i] == second[i], "Serial and parallel smoke output differs.");
                            if (!clip.Contains(x, y) || !serial.Bounds.Contains(x, y))
                            {
                                Check(first[i] == unchecked((int)0xff010203), "Copy must not write outside its clipped smoke bounds.");
                                if (clip.Contains(x, y)) Check(reference.Pixels[i] == 0, "Smoke raster bounds must include all GDI pixels.");
                                continue;
                            }
                            for (int channel = 0; channel < 4; channel++)
                            {
                                int shift = channel * 8;
                                int delta = Math.Abs(((first[i] >> shift) & 255) - ((reference.Pixels[i] >> shift) & 255));
                                Check(delta <= 1, "Parallel smoke must match GDI+ bilinear output within one channel value.");
                            }
                        }
                    smoke.Clear();
                    parallel.Prepare(smoke, RectangleF.Empty);
                    Check(!parallel.Ready, "Clearing smoke must invalidate the cached raster.");
                }
            }
        }

        public static void Layering()
        {
            const int width = 800, height = 600;
            using (World world = new World(width, height, 60f, 27))
            using (PixelSprite reference = new PixelSprite(width, height))
            using (PixelSprite actual = new PixelSprite(width, height))
            using (Graphics referenceGraphics = Graphics.FromImage(reference.Bitmap))
            using (Graphics actualGraphics = Graphics.FromImage(actual.Bitmap))
            {
                world.Smoke.Puff(400, 300, 180f, 3f, 0f, 0f, 0.4f);
                world.Smoke.Step(0.05f);
                world.Smoke.Render();
                Fruit fruit = new Fruit(0, Side.Left, width, height, world.S, world.MotionScale, world.Rng, 300f);
                fruit.X = 400; fruit.Y = 300;
                fruit.Sprite = new PixelSprite(8, 8);
                for (int i = 0; i < fruit.Sprite.Pixels.Length; i++) fruit.Sprite.Pixels[i] = -1;
                world.Fruits.Add(fruit);
                Rectangle clip = new Rectangle(200, 150, 400, 300);
                referenceGraphics.SetClip(clip);
                world.Render(referenceGraphics, clip);
                referenceGraphics.Flush(FlushIntention.Sync);
                SmokeRasterizer raster = new SmokeRasterizer(width, height, 4);
                raster.Prepare(world.Smoke, world.SmokeScreenRect());
                GCHandle handle = GCHandle.Alloc(actual.Pixels, GCHandleType.Pinned);
                try { raster.CopyTo(handle.AddrOfPinnedObject(), width * 4, clip); }
                finally { handle.Free(); }
                actualGraphics.SetClip(clip);
                world.Render(actualGraphics, clip, false);
                actualGraphics.Flush(FlushIntention.Sync);
                Check(actual.Pixels[300 * width + 400] == -1, "The fruit must be drawn on top of smoke.");
                for (int i = 0; i < actual.Pixels.Length; i++)
                    for (int channel = 0; channel < 4; channel++)
                    {
                        int shift = channel * 8;
                        int delta = Math.Abs(((actual.Pixels[i] >> shift) & 255) - ((reference.Pixels[i] >> shift) & 255));
                        Check(delta <= 1, "Smoke and foreground layering must match the original renderer.");
                    }
            }
        }
    }
}
