// Flies.cs
// Flies that gather around slop left on screen too long: they orbit and buzz,
// land on the goo to groom, and scatter when it is squeegeed.
// Mirrors web/src/lib/engine/flies.ts.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal enum FlyState
    {
        Arriving,
        Buzzing,
        Landed,
        Leaving
    }

    internal sealed class Fly
    {
        public float X, Y, Vx, Vy, HomeX, HomeY, Timer, JitterT, Jx, Jy, Phase, Wing, LandX, LandY;
        public float Facing = 1f;
        public FlyState State = FlyState.Arriving;
        public Side Side;
        public int SplatId;
        public bool Dead;
    }

    internal delegate float SurfaceProbe(Side side, float y);

    internal sealed class FlySwarm
    {
        public readonly List<Fly> Flies = new List<Fly>();
        public float Delay;
        public readonly int MaxFlies;
        private float _cooldown;

        public FlySwarm(float delaySeconds, int maxFlies)
        {
            Delay = delaySeconds;
            MaxFlies = maxFlies;
        }

        public int CountFor(int splatId, Side side)
        {
            int n = 0;
            foreach (Fly f in Flies) if (f.SplatId == splatId && f.Side == side && f.State != FlyState.Leaving) n++;
            return n;
        }

        public int CountSide(Side side)
        {
            int n = 0;
            foreach (Fly f in Flies) if (f.Side == side) n++;
            return n;
        }

        public void Scatter(Side side, float aboveY, Rng rng)
        {
            foreach (Fly f in Flies)
            {
                if (f.Side != side || f.State == FlyState.Leaving) continue;
                if (f.HomeY > aboveY + 60f) continue;
                f.State = FlyState.Leaving;
                float a = rng.Range(0.25f, 1.3f);
                float sp = rng.Range(520f, 820f);
                f.Vx = (side == Side.Left ? 1f : -1f) * M.Cos(a) * sp;
                f.Vy = -M.Sin(a) * sp;
            }
        }

        public bool CanSpawn { get { return _cooldown <= 0f && Flies.Count < MaxFlies; } }

        public void ArmCooldown(Rng rng) { _cooldown = rng.Range(3f, 7f); }

        public void Spawn(Side side, int splatId, float homeX, float homeY, int viewW, int viewH, Rng rng)
        {
            Fly f = new Fly();
            f.Side = side;
            f.SplatId = splatId;
            f.HomeX = homeX;
            f.HomeY = homeY;
            bool fromTop = rng.Chance(0.5f);
            f.X = fromTop ? homeX + (side == Side.Left ? 1f : -1f) * rng.Range(100f, 500f)
                : (side == Side.Left ? rng.Range(200f, 600f) : viewW - rng.Range(200f, 600f));
            f.Y = fromTop ? -30f : viewH + 30f;
            f.Phase = rng.Range(0f, 100f);
            Flies.Add(f);
        }

        public void Update(float dt, float s, int viewW, int viewH, Rng rng, SurfaceProbe surfaceX)
        {
            _cooldown -= dt;
            foreach (Fly f in Flies)
            {
                f.Phase += dt;
                f.Wing += dt * 60f;
                if (f.State == FlyState.Leaving)
                {
                    f.X += f.Vx * dt;
                    f.Y += f.Vy * dt;
                    if (f.X < -80f || f.X > viewW + 80f || f.Y < -80f || f.Y > viewH + 80f) f.Dead = true;
                    continue;
                }
                if (f.State == FlyState.Landed)
                {
                    f.Timer -= dt;
                    f.X = f.LandX;
                    f.Y = f.LandY;
                    if (f.Timer <= 0f)
                    {
                        f.State = FlyState.Buzzing;
                        f.Vy = -260f * s;
                        f.Vx = (f.Side == Side.Left ? 1f : -1f) * 180f * s;
                    }
                    continue;
                }
                f.JitterT -= dt;
                if (f.JitterT <= 0f)
                {
                    f.JitterT = rng.Range(0.08f, 0.32f);
                    float a = rng.Range(0f, M.TAU);
                    float m = rng.Range(500f, 1300f) * s;
                    f.Jx = M.Cos(a) * m;
                    f.Jy = M.Sin(a) * m;
                }
                float inward = f.Side == Side.Left ? 1f : -1f;
                float ox = M.Cos(f.Phase * 1.7f) * 70f * s + M.Sin(f.Phase * 0.63f) * 40f * s;
                float oy = M.Sin(f.Phase * 2.3f) * 55f * s + M.Cos(f.Phase * 0.91f) * 30f * s;
                float tx = f.HomeX + inward * (60f * s + Math.Abs(ox));
                float ty = f.HomeY + oy;
                float ax = (tx - f.X) * 7f + f.Jx - f.Vx * 2.4f;
                float ay = (ty - f.Y) * 7f + f.Jy - f.Vy * 2.4f;
                f.Vx += ax * dt;
                f.Vy += ay * dt;
                float sp = M.Len(f.Vx, f.Vy);
                float max = 420f * s;
                if (sp > max) { f.Vx *= max / sp; f.Vy *= max / sp; }
                f.X += f.Vx * dt;
                f.Y += f.Vy * dt;
                if (Math.Abs(f.Vx) > 30f * s) f.Facing = f.Vx > 0f ? 1f : -1f;
                if (f.State == FlyState.Arriving && M.Len(tx - f.X, ty - f.Y) < 140f * s) f.State = FlyState.Buzzing;
                if (f.State == FlyState.Buzzing && rng.Chance(0.18f * dt))
                {
                    float ly = f.HomeY + rng.Range(-50f, 70f) * s;
                    float sx = surfaceX(f.Side, ly);
                    if (!float.IsNaN(sx))
                    {
                        f.State = FlyState.Landed;
                        f.LandX = sx - inward * 3f * s;
                        f.LandY = ly;
                        f.Timer = rng.Range(1.8f, 5.5f);
                        f.Facing = rng.Sign();
                    }
                }
            }
            Flies.RemoveAll(delegate(Fly f) { return f.Dead; });
        }

        public bool Bounds(float s, out RectangleF r)
        {
            r = RectangleF.Empty;
            if (Flies.Count == 0) return false;
            float x0 = float.MaxValue, y0 = float.MaxValue, x1 = float.MinValue, y1 = float.MinValue;
            float m = 30f * s;
            foreach (Fly f in Flies)
            {
                x0 = Math.Min(x0, f.X - m); y0 = Math.Min(y0, f.Y - m);
                x1 = Math.Max(x1, f.X + m); y1 = Math.Max(y1, f.Y + m);
            }
            r = RectangleF.FromLTRB(x0, y0, x1, y1);
            return true;
        }

        /// <summary>One redraw rectangle per fly (so flies on both edges do not cover the whole screen).</summary>
        public void AddBounds(float s, List<RectangleF> list)
        {
            float m = 30f * s;
            foreach (Fly f in Flies) list.Add(new RectangleF(f.X - m, f.Y - m, m * 2f, m * 2f));
        }

        public void Draw(Graphics g, float s)
        {
            foreach (Fly f in Flies) DrawFly(g, f, s);
        }

        private static void DrawFly(Graphics g, Fly f, float s)
        {
            float k = s * 1.55f;
            bool landed = f.State == FlyState.Landed;
            GraphicsState st = g.Save();
            g.TranslateTransform(f.X, f.Y);
            g.ScaleTransform(f.Facing, 1f);
            float tilt = landed ? 0f : M.Clamp(f.Vy * 0.0012f, -0.5f, 0.5f);
            g.RotateTransform(tilt * 57.2957795f);
            float flap = landed ? 0.15f : M.Sin(f.Wing) * 0.7f;
            int ghosts = landed ? 1 : 2;
            for (int gi = 0; gi < ghosts; gi++)
            {
                float a = gi == 0 ? flap : -flap * 0.6f;
                float al = gi == 0 ? 0.55f : 0.25f;
                for (int side = -1; side <= 1; side += 2)
                {
                    GraphicsState ws = g.Save();
                    g.TranslateTransform(-1f * k, -3f * k);
                    g.RotateTransform((-0.55f + a * side * 0.6f + (side < 0 ? -0.25f : 0.1f)) * 57.2957795f);
                    RectangleF wr = Ink.Rect(-6f * k, -2f * k, 7.5f * k, 3.6f * k);
                    g.FillEllipse(Ink.Brush(0xd6ecff, al), wr);
                    g.DrawEllipse(Ink.Pen(Palette.Ink, 1f * k, al + 0.15f), wr);
                    g.Restore(ws);
                }
            }
            if (landed)
            {
                Pen lp = Ink.Pen(Palette.Ink, 1.1f * k, 1f);
                float rub = M.Sin(f.Phase * 14f) * 1.5f * k;
                for (int i = -1; i <= 1; i++) g.DrawLine(lp, i * 3f * k, 3f * k, i * 4.5f * k + (i == 1 ? rub : 0f), 7f * k);
            }
            RectangleF body = Ink.Rect(-2f * k, 0f, 6.5f * k, 4.6f * k);
            g.FillEllipse(Ink.Brush(0x2a2f3a, 1f), body);
            g.DrawEllipse(Ink.Pen(Palette.Ink, 1.5f * k, 1f), body);
            Ink.FillEllipseRot(g, -3.5f * k, -1.8f * k, 3f * k, 1.5f * k, -0.3f, 0x5ad07a, 1f);
            Pen stripe = Ink.Pen(0x0a0a0e, 1f * k, 0.7f);
            for (int i = 0; i < 2; i++)
            {
                float sx = i == 0 ? -5f : -2f;
                using (GraphicsPath sp = new GraphicsPath())
                {
                    Grenade.Quad(sp, sx * k, -3.6f * k, (sx + 1f) * k, 0f, sx * k, 3.6f * k);
                    g.DrawPath(stripe, sp);
                }
            }
            RectangleF head = Ink.Rect(5f * k, -0.5f * k, 3.4f * k, 3.4f * k);
            g.FillEllipse(Ink.Brush(0x20242c, 1f), head);
            g.DrawEllipse(Ink.Pen(Palette.Ink, 1.5f * k, 1f), head);
            for (int i = 0; i < 2; i++)
            {
                float ey = i == 0 ? -2.2f : 1.4f;
                RectangleF eye = Ink.Rect(6.4f * k, ey * k, 2.3f * k, 2.3f * k);
                g.FillEllipse(Ink.Brush(0xd0283a, 1f), eye);
                g.DrawEllipse(Ink.Pen(Palette.Ink, 0.9f * k, 1f), eye);
                Ink.FillEllipse(g, 5.8f * k, (ey - 0.8f) * k, 0.8f * k, 0.8f * k, 0xffffff, 1f);
            }
            g.Restore(st);
        }
    }
}
