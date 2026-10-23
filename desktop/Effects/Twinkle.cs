// Twinkle.cs
// Barely-there crystal glints for genuinely human messages: a brief
// multi-faceted sparkle with faint prismatic fringes.
// Mirrors web/src/lib/engine/twinkle.ts.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal sealed class Twinkle
    {
        public readonly float X, Y, Life, Size, Rot;
        public float Age;
        public bool Done;

        public Twinkle(float x, float y, float delay, float s, Rng rng)
        {
            X = x;
            Y = y;
            Age = -delay;
            Life = rng.Range(0.55f, 0.8f);
            Size = rng.Range(9f, 15f) * s;
            Rot = rng.Range(-0.25f, 0.25f);
        }

        public void Update(float dt)
        {
            Age += dt;
            if (Age > Life) Done = true;
        }

        public float Envelope()
        {
            if (Age <= 0f || Age >= Life) return 0f;
            float e = M.Sin(M.PI * (Age / Life));
            return e * e * e;
        }

        public RectangleF Bounds { get { return new RectangleF(X - Size - 4f, Y - Size - 4f, Size * 2f + 8f, Size * 2f + 8f); } }

        public void Draw(Graphics g, float s)
        {
            float e = Envelope();
            if (e <= 0.01f) return;
            float L = Size * (0.55f + 0.45f * e);
            float peak = 0.55f * e;
            GraphicsState st = g.Save();
            g.TranslateTransform(X, Y);
            g.RotateTransform((Rot + Age * 0.6f) * 57.2957795f);
            using (GraphicsPath glow = new GraphicsPath())
            {
                glow.AddEllipse(-L * 0.5f, -L * 0.5f, L, L);
                using (PathGradientBrush pg = new PathGradientBrush(glow))
                {
                    pg.CenterColor = Ink.C(0xffffff, peak * 0.7f);
                    pg.SurroundColors = new Color[] { Color.FromArgb(0, 255, 255, 255) };
                    g.FillPath(pg, glow);
                }
            }
            for (int i = 0; i < 2; i++)
            {
                float ang = i == 0 ? 0f : M.PI / 2f;
                Ray(g, L, 1.3f * s, ang, 0x78e6ff, peak * 0.35f, 0.9f * s);
                Ray(g, L, 1.3f * s, ang, 0xff8ce6, peak * 0.35f, -0.9f * s);
                Ray(g, L, 1.1f * s, ang, 0xffffff, peak, 0f);
            }
            Ray(g, L * 0.42f, 0.8f * s, M.PI / 4f, 0xffffff, peak * 0.7f, 0f);
            Ray(g, L * 0.42f, 0.8f * s, -M.PI / 4f, 0xffffff, peak * 0.7f, 0f);
            Ink.FillEllipse(g, 0f, 0f, 1.3f * s, 1.3f * s, 0xffffff, Math.Min(1f, peak * 1.6f));
            g.Restore(st);
        }

        private static void Ray(Graphics g, float len, float wid, float ang, int color, float alpha, float off)
        {
            GraphicsState st = g.Save();
            g.RotateTransform(ang * 57.2957795f);
            g.TranslateTransform(off, 0f);
            PointF[] pts = new PointF[] { new PointF(-len, 0f), new PointF(0f, -wid), new PointF(len, 0f), new PointF(0f, wid) };
            g.FillPolygon(Ink.Brush(color, alpha), pts);
            g.Restore(st);
        }
    }
}
