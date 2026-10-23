// Explosion.cs
// Comic-book detonation: flash starburst, cel fireball puffs cooling into
// hatched soot, shockwave, speed lines and an onomatopoeia.
// Mirrors web/src/lib/engine/explosion.ts.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal sealed class Puff
    {
        public float Dx, Dy, D0, D1, R0, R1, Delay, Life;
    }

    internal struct PuffState
    {
        public float X, Y, R, Heat, Alpha, U;
    }

    internal sealed class Explosion
    {
        private static readonly string[] WordsIn = new string[] { "SPLAT!", "KA-SPLORT!", "BLAMMO!", "SPLOOSH!", "KER-SLOP!" };
        private static readonly string[] WordsOut = new string[] { "OOPS!", "SELF-SLOP!", "KA-BLOOEY!", "YIKES!", "SPLAT!" };

        public readonly float X, Y, Inward, S, Size;
        public float Age;
        public bool Done;
        public readonly List<Puff> Puffs = new List<Puff>();
        private readonly float[] _spikes = new float[16];
        private readonly string _word;
        private readonly float _wordRot;

        public Explosion(float x, float y, float inward, float s, Rng rng, bool outgoing, float size)
        {
            X = x; Y = y; Inward = inward; S = s; Size = size;
            int n = (int)Math.Round(13f * size) + 3;
            for (int i = 0; i < n; i++)
            {
                float a = (inward > 0f ? 0f : M.PI) + rng.Range(-1.9f, 1.9f);
                bool core = i < 4;
                Puffs.Add(new Puff
                {
                    Dx = M.Cos(a),
                    Dy = M.Sin(a),
                    D0 = core ? 0f : rng.Range(10f, 30f) * s,
                    D1 = (core ? rng.Range(20f, 60f) : rng.Range(80f, 175f)) * s * size,
                    R0 = rng.Range(16f, 28f) * s * size,
                    R1 = (core ? rng.Range(78f, 100f) : rng.Range(44f, 72f)) * s * size,
                    Delay = core ? rng.Range(0f, 0.04f) : rng.Range(0.02f, 0.16f),
                    Life = core ? rng.Range(0.9f, 1.2f) : rng.Range(1.1f, 1.7f)
                });
            }
            Puffs.Sort(delegate(Puff p, Puff q)
            {
                int c = q.Delay.CompareTo(p.Delay);
                return c != 0 ? c : p.R1.CompareTo(q.R1);
            });
            for (int i = 0; i < _spikes.Length; i++) _spikes[i] = rng.Range(0.78f, 1.25f);
            string[] words = outgoing ? WordsOut : WordsIn;
            _word = words[rng.Int(words.Length)];
            _wordRot = rng.Range(-0.14f, 0.1f);
        }

        public void Update(float dt)
        {
            Age += dt;
            if (Age > 2.3f) Done = true;
        }

        public RectangleF Bounds
        {
            get
            {
                float r = 330f * S * Size;
                float wx = X + Inward * 210f * S;
                RectangleF a = new RectangleF(X - r, Y - r, r * 2f, r * 2f);
                RectangleF b = new RectangleF(wx - 260f * S, Y - 230f * S, 520f * S, 200f * S);
                return RectangleF.Union(a, b);
            }
        }

        public PuffState State(Puff p)
        {
            PuffState st;
            float u = M.Clamp01((Age - p.Delay) / p.Life);
            float grow = M.EaseOutCubic(Math.Min(1f, u * 2.4f));
            st.R = (p.R0 + (p.R1 - p.R0) * grow) * (1f - 0.3f * M.Smoothstep(0.55f, 1f, u));
            float d = p.D0 + (p.D1 - p.D0) * M.EaseOutCubic(u);
            float rise = u * u * 70f * S;
            st.X = X + p.Dx * d;
            st.Y = Y + p.Dy * d - rise;
            st.Heat = 1f - M.Smoothstep(0.12f, 0.92f, u);
            st.Alpha = 1f - M.Smoothstep(0.62f, 0.96f, u);
            st.U = u;
            return st;
        }

        public void Draw(Graphics g)
        {
            float s = S * Size;
            float a = Age;
            if (a < 0.32f)
            {
                float k = a / 0.32f;
                for (int i = 0; i < 18; i++)
                {
                    float ang = i / 18f * M.TAU + 0.17f;
                    float r1 = (120f + 160f * M.EaseOutCubic(k)) * s;
                    float r2 = r1 + (60f + (i % 3) * 30f) * s * (1f - k);
                    g.DrawLine(Ink.Pen(Palette.Ink, (i % 2 == 0 ? 4f : 2.4f) * S, 0.85f * (1f - k)),
                        X + M.Cos(ang) * r1, Y + M.Sin(ang) * r1, X + M.Cos(ang) * r2, Y + M.Sin(ang) * r2);
                }
            }
            if (a < 0.45f)
            {
                float k = a / 0.45f;
                float rr = (40f + 280f * M.EaseOutCubic(k)) * s;
                g.DrawEllipse(Ink.Pen(0xffffff, 9f * S * (1f - k), 0.9f * (1f - k)), Ink.Rect(X, Y, rr, rr));
            }
            for (int i = 0; i < Puffs.Count; i++)
            {
                Puff p = Puffs[i];
                if (a < p.Delay) continue;
                PuffState st = State(p);
                if (st.Alpha <= 0.01f || st.R < 1f) continue;
                DrawPuff(g, st);
            }
            if (a < 0.24f)
            {
                float k = a / 0.24f;
                float R = 150f * s * M.EaseOutBack(Math.Min(1f, a / 0.1f));
                float alpha = 1f - M.Smoothstep(0.55f, 1f, k);
                int n = _spikes.Length;
                PointF[] pts = new PointF[n * 2];
                for (int i = 0; i < n * 2; i++)
                {
                    float ang = (float)i / (n * 2) * M.TAU;
                    float r = i % 2 == 0 ? R * _spikes[i >> 1] : R * 0.48f;
                    pts[i] = new PointF(X + M.Cos(ang) * r, Y + M.Sin(ang) * r);
                }
                g.FillPolygon(Ink.Brush(0xfff3a6, alpha), pts);
                Pen pen = Ink.Pen(Palette.Ink, 5f * S, alpha);
                pen.LineJoin = LineJoin.Miter;
                g.DrawPolygon(pen, pts);
                pen.LineJoin = LineJoin.Round;
                Ink.FillEllipse(g, X, Y, R * 0.42f, R * 0.42f, 0xffffff, alpha);
            }
            DrawWord(g);
        }

        private void DrawPuff(Graphics g, PuffState st)
        {
            int baseC = Palette.Heat(st.Heat);
            int shadow = Palette.Heat(st.Heat - 0.28f);
            int light = Palette.Heat(Math.Min(1f, st.Heat + 0.3f));
            float lw = (3.6f - 2f * st.U) * S;
            float x = st.X, y = st.Y, r = st.R, al = st.Alpha;
            GraphicsState gs = g.Save();
            using (GraphicsPath clip = new GraphicsPath())
            {
                clip.AddEllipse(Ink.Rect(x, y, r, r));
                g.FillPath(Ink.Brush(shadow, al), clip);
                Ink.ClipTo(g, clip, CombineMode.Intersect);
                g.FillEllipse(Ink.Brush(baseC, al), Ink.Rect(x - r * 0.16f, y - r * 0.2f, r * 0.9f, r * 0.9f));
                g.FillEllipse(Ink.Brush(light, al), Ink.Rect(x - r * 0.34f, y - r * 0.38f, r * 0.45f, r * 0.45f));
                if (st.U > 0.35f)
                {
                    using (GraphicsPath lit = new GraphicsPath())
                    {
                        lit.AddEllipse(Ink.Rect(x - r * 0.16f, y - r * 0.2f, r * 0.9f, r * 0.9f));
                        Ink.ClipTo(g, lit, CombineMode.Exclude);
                        Ink.Hatch(g, x - r, y - r, x + r, y + r, 5.5f * S, 1.4f * S, 0.45f * al);
                    }
                }
            }
            g.Restore(gs);
            g.DrawEllipse(Ink.Pen(Palette.Ink, lw, al * 0.95f), Ink.Rect(x, y, r, r));
        }

        private void DrawWord(Graphics g)
        {
            float a = Age - 0.06f;
            if (a <= 0f || a > 1.35f) return;
            float pop = M.EaseOutBack(Math.Min(1f, a / 0.28f));
            float fade = 1f - M.Smoothstep(1.0f, 1.35f, a);
            float size = 64f * S * Size;
            GraphicsState st = g.Save();
            g.TranslateTransform(X + Inward * 210f * S, Y - 120f * S - a * 18f * S);
            g.RotateTransform(_wordRot * 57.2957795f);
            g.ScaleTransform(Math.Max(0.01f, pop), Math.Max(0.01f, pop));
            using (GraphicsPath path = new GraphicsPath())
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                path.AddString(_word, Ink.ComicFamily, (int)(FontStyle.Bold | FontStyle.Italic), size, new PointF(0f, 0f), sf);
                // extruded ink shadow
                GraphicsState s2 = g.Save();
                g.TranslateTransform(5f * S, 6f * S);
                g.FillPath(Ink.Brush(Palette.Ink, fade), path);
                g.Restore(s2);
                Pen outline = Ink.Pen(Palette.Ink, 9f * S, fade);
                g.DrawPath(outline, path);
                RectangleF b = path.GetBounds();
                if (b.Height < 1f) b.Height = 1f;
                using (LinearGradientBrush lg = new LinearGradientBrush(new RectangleF(b.X, b.Y - 1f, Math.Max(1f, b.Width), b.Height + 2f),
                    Color.White, Color.Orange, LinearGradientMode.Vertical))
                {
                    ColorBlend cb = new ColorBlend(3);
                    cb.Colors = new Color[] { Ink.C(0xffffff, fade), Ink.C(0xffe24a, fade), Ink.C(0xff7a1a, fade) };
                    cb.Positions = new float[] { 0f, 0.35f, 1f };
                    lg.InterpolationColors = cb;
                    g.FillPath(lg, path);
                }
            }
            g.Restore(st);
        }
    }
}
