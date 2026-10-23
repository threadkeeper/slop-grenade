// Squeegee.cs
// Brass-handled squeegee that wipes one monitor edge clean.
// Mirrors web/src/lib/engine/squeegee.ts.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal sealed class Squeegee
    {
        public readonly Side Side;
        public float Y;
        public readonly float Speed, Width;
        public readonly int ViewW, ViewH;
        public readonly SlopPalette Pal;
        public float Pile, Age;
        public bool Done;

        public Squeegee(Side side, int viewW, int viewH, int stripW, SlopPalette pal)
        {
            Side = side;
            ViewW = viewW;
            ViewH = viewH;
            Width = stripW * 0.92f;
            Pal = pal;
            Y = -60f;
            Speed = Math.Max(620f, viewH * 0.85f);
        }

        public void Update(float dt)
        {
            Age += dt;
            Y += Speed * dt;
            if (Y > ViewH + 140f) Done = true;
        }

        public RectangleF Bounds(float s)
        {
            float x0 = Side == Side.Left ? 0f : ViewW - Width - 40f * s;
            return new RectangleF(x0, Y - 200f * s, Width + 40f * s, 230f * s);
        }

        public void Draw(Graphics g, float s)
        {
            bool left = Side == Side.Left;
            float x0 = left ? 0f : ViewW - Width;
            float x1 = left ? Width : ViewW;
            float y = Y;
            float wob = M.Sin(Age * 18f) * 0.02f;
            GraphicsState st = g.Save();
            g.TranslateTransform((x0 + x1) / 2f, y);
            g.RotateTransform(wob * 57.2957795f);
            g.TranslateTransform(-(x0 + x1) / 2f, -y);
            RectangleF trail = new RectangleF(x0, y - 180f * s, x1 - x0, 180f * s);
            using (LinearGradientBrush lg = new LinearGradientBrush(new RectangleF(trail.X, trail.Y - 1f, trail.Width, trail.Height + 2f),
                Color.FromArgb(0, 190, 235, 255), Color.FromArgb(56, 190, 235, 255), LinearGradientMode.Vertical))
            {
                g.FillRectangle(lg, trail);
            }
            float ph = Math.Min(46f * s, M.Sqrt(Math.Max(0f, Pile)) * 0.22f);
            if (ph > 0.5f)
            {
                float cx = (x0 + x1) / 2f, rx = (x1 - x0) * 0.46f;
                using (GraphicsPath p = new GraphicsPath())
                {
                    p.AddArc(cx - rx, y - 12f * s - ph, rx * 2f, ph * 2f, 180f, 180f);
                    p.CloseFigure();
                    g.FillPath(Ink.Brush(Pal.Base, 1f), p);
                    g.DrawPath(Ink.Pen(Palette.Ink, 2.6f * s, 1f), p);
                }
                Ink.FillEllipseRot(g, cx - (x1 - x0) * 0.18f, y - 12f * s - ph * 0.55f, (x1 - x0) * 0.1f, ph * 0.18f, -0.2f, Pal.Light, 1f);
            }
            float hx = left ? x0 + (x1 - x0) * 0.58f : x1 - (x1 - x0) * 0.58f;
            GraphicsState hs = g.Save();
            g.TranslateTransform(hx, y - 16f * s);
            g.RotateTransform((left ? 0.32f : -0.32f) * 57.2957795f);
            g.FillRectangle(Ink.Brush(0x7a4a26, 1f), -7f * s, -96f * s, 14f * s, 90f * s);
            g.DrawRectangle(Ink.Pen(Palette.Ink, 2.8f * s, 1f), -7f * s, -96f * s, 14f * s, 90f * s);
            g.FillRectangle(Ink.Brush(0xa8703c, 1f), -4f * s, -94f * s, 4f * s, 86f * s);
            g.FillRectangle(Ink.Brush(Palette.BrassBase, 1f), -9f * s, -20f * s, 18f * s, 14f * s);
            g.DrawRectangle(Ink.Pen(Palette.Ink, 2.8f * s, 1f), -9f * s, -20f * s, 18f * s, 14f * s);
            g.Restore(hs);
            g.FillRectangle(Ink.Brush(Palette.BrassBase, 1f), x0, y - 22f * s, x1 - x0, 14f * s);
            g.DrawRectangle(Ink.Pen(Palette.Ink, 2.8f * s, 1f), x0, y - 22f * s, x1 - x0, 14f * s);
            g.FillRectangle(Ink.Brush(Palette.BrassLight, 1f), x0 + 3f * s, y - 20f * s, x1 - x0 - 6f * s, 3f * s);
            for (float rx = x0 + 14f * s; rx < x1 - 8f * s; rx += 36f * s) Ink.FillEllipse(g, rx, y - 15f * s, 2.6f * s, 2.6f * s, Palette.BrassDark, 1f);
            g.FillRectangle(Ink.Brush(0x23262e, 1f), x0, y - 8f * s, x1 - x0, 10f * s);
            g.DrawRectangle(Ink.Pen(Palette.Ink, 2.8f * s, 1f), x0, y - 8f * s, x1 - x0, 10f * s);
            g.FillRectangle(Ink.Brush(0xffffff, 0.25f), x0 + 2f * s, y - 6f * s, x1 - x0 - 4f * s, 2f * s);
            g.Restore(st);
        }
    }
}
