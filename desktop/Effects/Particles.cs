// Particles.cs
// Particle pool for sparks, slop globs, the pin ring / spoon and juice droplets.
// Mirrors web/src/lib/engine/particles.ts.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal enum ParticleKind
    {
        Spark,
        Glob,
        Spoon,
        Ring,
        Juice
    }

    internal sealed class Particle
    {
        public EffectMessage Message;
        public ParticleKind Kind;
        public float X, Y, Vx, Vy, R = 1f, Rot, Spin, Age, Life = 1f, Gravity, Drag;
        public int Color = 0xffffff;
        public SlopPalette Pal;
        /// <summary>-1 none, 0 sticks to the left edge, 1 to the right edge.</summary>
        public int Sticky = -1;
        public bool Dead;
    }

    internal sealed class ParticleSystem
    {
        public readonly List<Particle> Items = new List<Particle>();
        private readonly int _max;

        public ParticleSystem(int max) { _max = max; }

        public Particle Spawn(ParticleKind kind)
        {
            Particle p = new Particle();
            p.Kind = kind;
            if (Items.Count >= _max) Items.RemoveAt(0);
            Items.Add(p);
            return p;
        }

        public void Sparks(float x, float y, int n, float speed, float s, Rng rng)
        {
            for (int i = 0; i < n; i++)
            {
                Particle p = Spawn(ParticleKind.Spark);
                float a = rng.Range(0f, M.TAU);
                float v = speed * rng.Range(0.35f, 1f);
                p.X = x; p.Y = y;
                p.Vx = M.Cos(a) * v; p.Vy = M.Sin(a) * v;
                p.Life = rng.Range(0.25f, 0.7f);
                p.Gravity = 900f * s;
                p.Drag = 2.2f;
                p.R = rng.Range(1.2f, 2.4f) * s;
                p.Color = rng.Chance(0.5f) ? 0xffffff : 0xffd23f;
            }
        }

        public void Update(float dt, int viewW, int viewH, Action<Particle> onStick)
        {
            for (int i = 0; i < Items.Count; i++)
            {
                Particle p = Items[i];
                if (p.Dead) continue;
                p.Age += dt;
                if (p.Age >= p.Life) { p.Dead = true; continue; }
                float dk = M.Exp(-p.Drag * dt);
                p.Vx *= dk;
                p.Vy = p.Vy * dk + p.Gravity * dt;
                p.X += p.Vx * dt;
                p.Y += p.Vy * dt;
                p.Rot += p.Spin * dt;
                if (p.Sticky == 0 && p.X - p.R <= 0f) { p.X = 0f; onStick(p); p.Dead = true; }
                else if (p.Sticky == 1 && p.X + p.R >= viewW) { p.X = viewW; onStick(p); p.Dead = true; }
                else if (p.Y - p.R * 4f > viewH || p.X < -200f || p.X > viewW + 200f) p.Dead = true;
            }
            Items.RemoveAll(delegate(Particle p) { return p.Dead; });
        }

        /// <summary>Union of particle bounds (for dirty rectangles); false when empty.</summary>
        public bool Bounds(out RectangleF r)
        {
            r = RectangleF.Empty;
            if (Items.Count == 0) return false;
            float x0 = float.MaxValue, y0 = float.MaxValue, x1 = float.MinValue, y1 = float.MinValue;
            for (int i = 0; i < Items.Count; i++)
            {
                Particle p = Items[i];
                float m = p.Kind == ParticleKind.Spoon || p.Kind == ParticleKind.Ring ? 60f * p.R : p.R * 3f + 30f;
                x0 = Math.Min(x0, p.X - m); y0 = Math.Min(y0, p.Y - m);
                x1 = Math.Max(x1, p.X + m); y1 = Math.Max(y1, p.Y + m);
            }
            r = RectangleF.FromLTRB(x0, y0, x1, y1);
            return true;
        }

        /// <summary>Redraw rectangles for the particles, one per screen half.</summary>
        public void AddBounds(float midX, List<RectangleF> list)
        {
            for (int half = 0; half < 2; half++)
            {
                bool any = false;
                float x0 = float.MaxValue, y0 = float.MaxValue, x1 = float.MinValue, y1 = float.MinValue;
                for (int i = 0; i < Items.Count; i++)
                {
                    Particle p = Items[i];
                    if ((p.X < midX) != (half == 0)) continue;
                    float m = p.Kind == ParticleKind.Spoon || p.Kind == ParticleKind.Ring ? 60f * p.R : p.R * 3f + 30f;
                    x0 = Math.Min(x0, p.X - m); y0 = Math.Min(y0, p.Y - m);
                    x1 = Math.Max(x1, p.X + m); y1 = Math.Max(y1, p.Y + m);
                    any = true;
                }
                if (any) list.Add(RectangleF.FromLTRB(x0, y0, x1, y1));
            }
        }

        public void Draw(Graphics g, float s)
        {
            for (int i = 0; i < Items.Count; i++)
            {
                Particle p = Items[i];
                float u = p.Age / p.Life;
                switch (p.Kind)
                {
                    case ParticleKind.Spark:
                    {
                        float sp = M.Len(p.Vx, p.Vy);
                        if (sp < 1f) break;
                        float len = Math.Min(26f * s, sp * 0.03f);
                        float nx = p.Vx / sp, ny = p.Vy / sp;
                        g.DrawLine(Ink.Pen(p.Color, p.R * (1f - u * 0.6f), 1f - u * u), p.X, p.Y, p.X - nx * len, p.Y - ny * len);
                        break;
                    }
                    case ParticleKind.Glob:
                    case ParticleKind.Juice:
                    {
                        float sp = M.Len(p.Vx, p.Vy);
                        float stretch = 1f + Math.Min(0.9f, sp / (1400f * s));
                        float ang = M.Atan2(p.Vy, p.Vx);
                        int baseC = p.Pal != null ? p.Pal.Base : p.Color;
                        int light = p.Pal != null ? p.Pal.Light : 0xffffff;
                        GraphicsState st = g.Save();
                        g.TranslateTransform(p.X, p.Y);
                        g.RotateTransform(ang * 57.2957795f);
                        RectangleF rr = Ink.Rect(0f, 0f, p.R * stretch, p.R / M.Sqrt(stretch));
                        g.FillEllipse(Ink.Brush(baseC, 1f), rr);
                        g.DrawEllipse(Ink.Pen(Palette.Ink, Math.Max(1.2f, p.R * 0.32f), 1f), rr);
                        g.Restore(st);
                        Ink.FillEllipseRot(g, p.X - p.R * 0.32f, p.Y - p.R * 0.34f, p.R * 0.3f, p.R * 0.2f, -0.6f, light, 1f);
                        break;
                    }
                    case ParticleKind.Spoon:
                    {
                        GraphicsState st = g.Save();
                        g.TranslateTransform(p.X, p.Y);
                        Grenade.DrawSpoon(g, -10f * p.R, -20f * p.R, p.R, 3.1f * p.R, p.Rot);
                        g.Restore(st);
                        break;
                    }
                    case ParticleKind.Ring:
                        Grenade.DrawRing(g, p.X, p.Y, p.R, p.Rot);
                        break;
                }
            }
        }
    }
}
