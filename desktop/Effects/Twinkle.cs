// Twinkle.cs
// Crystal glint for genuinely human messages: a bright four-point star with a
// thin ink outline and a warm halo, so it reads on light and dark windows.
// Mirrors web/src/lib/engine/twinkle.ts.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal sealed class Twinkle
    {
        public EffectMessage Message;
        public readonly float X, Y, Life, Size, Rot, Spin;
        public float Age;
        public bool Done;

        /// <summary>`s` is the glint artwork scale; `lead` glints are the big ones.</summary>
        public Twinkle(float x, float y, float delay, float s, Rng rng, bool lead)
        {
            X = x;
            Y = y;
            Age = -delay;
            Life = rng.Range(1.0f, 1.35f);
            Size = (lead ? rng.Range(26f, 34f) : rng.Range(14f, 20f)) * s;
            Rot = rng.Range(-0.3f, 0.3f);
            Spin = rng.Range(0.5f, 1.1f) * rng.Sign();
        }

        public void Update(float dt)
        {
            Age += dt;
            if (Age > Life) Done = true;
        }

        /// <summary>0..1 brightness: quick flare, short hold, soft fade.</summary>
        public float Envelope()
        {
            if (Age <= 0f || Age >= Life) return 0f;
            float u = Age / Life;
            if (u < 0.18f)
            {
                float k = u / 0.18f;
                return k * k * (3f - 2f * k);
            }
            if (u < 0.45f) return 1f;
            float q = (u - 0.45f) / 0.55f;
            return 1f - q * q * (3f - 2f * q);
        }

        public RectangleF Bounds
        {
            get
            {
                float r = Size * 1.25f + 6f;
                return new RectangleF(X - r, Y - r, r * 2f, r * 2f);
            }
        }

        public void Draw(Graphics g, float s)
        {
            float e = Envelope();
            if (e <= 0.01f) return;
            float L = Math.Max(2f, Size * (0.55f + 0.45f * e));
            GraphicsState st = g.Save();
            g.TranslateTransform(X, Y);
            // warm halo
            using (GraphicsPath halo = new GraphicsPath())
            {
                float hr = L * 1.05f;
                halo.AddEllipse(-hr, -hr, hr * 2f, hr * 2f);
                using (PathGradientBrush pg = new PathGradientBrush(halo))
                {
                    ColorBlend cb = new ColorBlend(3);
                    // PathGradient blends run from the rim (0) to the centre (1)
                    cb.Colors = new Color[] { Ink.C(0xffd66e, 0f), Ink.C(0xffd66e, 0.35f * e), Ink.C(0xfffce6, 0.75f * e) };
                    cb.Positions = new float[] { 0f, 0.65f, 1f };
                    pg.InterpolationColors = cb;
                    g.FillPath(pg, halo);
                }
            }
            g.RotateTransform((Rot + Age * Spin) * 57.2957795f);
            // star: four long points, four short diagonal points, pinched waist
            PointF[] pts = new PointF[16];
            for (int k = 0; k < 8; k++)
            {
                float a = k * M.PI / 4f;
                float r = k % 2 == 0 ? L : L * 0.5f;
                float wa = a + M.PI / 8f;
                float wr = L * 0.21f;
                pts[k * 2] = new PointF(M.Cos(a) * r, M.Sin(a) * r);
                pts[k * 2 + 1] = new PointF(M.Cos(wa) * wr, M.Sin(wa) * wr);
            }
            using (GraphicsPath star = new GraphicsPath())
            {
                star.AddPolygon(pts);
                Pen ink = Ink.Pen(Palette.Ink, Math.Max(1.2f, 1.6f * s), 0.65f * e);
                ink.LineJoin = LineJoin.Round;
                g.DrawPath(ink, star);
                using (PathGradientBrush fill = new PathGradientBrush(star))
                {
                    fill.CenterPoint = new PointF(0f, 0f);
                    fill.CenterColor = Ink.C(0xffffff, e);
                    Color[] rim = new Color[pts.Length];
                    for (int i = 0; i < rim.Length; i++) rim[i] = Ink.C(0xffcd50, e);
                    fill.SurroundColors = rim;
                    g.FillPath(fill, star);
                }
            }
            // prismatic glints at the long tips
            for (int k = 0; k < 4; k++)
            {
                float a = k * M.PI / 2f;
                Ink.FillEllipse(g, M.Cos(a) * L * 0.72f, M.Sin(a) * L * 0.72f, Math.Max(1f, 1.5f * s), Math.Max(1f, 1.5f * s), k % 2 == 0 ? 0x78e6ff : 0xff8ce6, 0.9f * e);
            }
            // hot white core
            float c = Math.Max(1.4f, L * 0.1f);
            Ink.FillEllipse(g, 0f, 0f, c, c, 0xffffff, e);
            g.Restore(st);
        }
    }
}
