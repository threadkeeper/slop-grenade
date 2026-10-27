// Grenade.cs
// The cute inked hand grenade: slow-motion ballistic flight with a lit fuse,
// detonating at the monitor edge. Mirrors web/src/lib/engine/grenade.ts.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal sealed class Grenade
    {
        public EffectMessage Message;
        public float X, Y, Vx, Vy, Angle, Spin, Age, SparkPhase;
        public readonly float FlightTime, Gravity, TargetX, TargetY;
        public readonly Side Side;
        public readonly SlopPalette Pal;
        public readonly float S;
        public bool SpoonAttached = true;
        public bool Done;

        public float T { get { return Math.Min(1f, Age / FlightTime); } }

        public Grenade(Side side, SlopPalette pal, int viewW, int viewH, float scale, Rng rng)
        {
            Side = side;
            Pal = pal;
            S = scale;
            float inward = side == Side.Left ? 1f : -1f;
            float edge = side == Side.Left ? 0f : viewW;
            TargetX = edge + inward * 56f * scale;
            TargetY = viewH * rng.Range(0.2f, 0.62f);
            X = viewW * 0.5f + inward * viewW * rng.Range(0.1f, 0.32f);
            Y = viewH + 70f * scale;
            FlightTime = rng.Range(1.35f, 1.6f);
            Gravity = 1500f * scale;
            float T0 = FlightTime;
            Vx = (TargetX - X) / T0;
            Vy = (TargetY - Y - 0.5f * Gravity * T0 * T0) / T0;
            Spin = -inward * rng.Range(5.5f, 7.5f);
        }

        /// <summary>Advance with game time; true on the frame it arrives.</summary>
        public bool Update(float dt)
        {
            if (Done) return false;
            Age += dt;
            SparkPhase += dt * 40f;
            if (Age >= FlightTime)
            {
                X = TargetX;
                Y = TargetY;
                Done = true;
                return true;
            }
            Vy += Gravity * dt;
            X += Vx * dt;
            Y += Vy * dt;
            Angle += Spin * dt;
            return false;
        }

        public bool UhOh { get { return T > 0.78f; } }

        public float Radius { get { return 120f * S; } }

        // ------------------------------------------------------------------ drawing

        private static void Egg(GraphicsPath p, float ox, float oy, float k)
        {
            p.StartFigure();
            p.AddBezier(ox, oy - 34f * k, ox + 18f * k, oy - 34f * k, ox + 31f * k, oy - 16f * k, ox + 31f * k, oy + 4f * k);
            p.AddBezier(ox + 31f * k, oy + 4f * k, ox + 31f * k, oy + 24f * k, ox + 18f * k, oy + 36f * k, ox, oy + 36f * k);
            p.AddBezier(ox, oy + 36f * k, ox - 18f * k, oy + 36f * k, ox - 31f * k, oy + 24f * k, ox - 31f * k, oy + 4f * k);
            p.AddBezier(ox - 31f * k, oy + 4f * k, ox - 31f * k, oy - 16f * k, ox - 18f * k, oy - 34f * k, ox, oy - 34f * k);
            p.CloseFigure();
        }

        public static void RoundRect(GraphicsPath p, float x, float y, float w, float h, float r)
        {
            float d = r * 2f;
            p.StartFigure();
            p.AddArc(x, y, d, d, 180f, 90f);
            p.AddArc(x + w - d, y, d, d, 270f, 90f);
            p.AddArc(x + w - d, y + h - d, d, d, 0f, 90f);
            p.AddArc(x, y + h - d, d, d, 90f, 90f);
            p.CloseFigure();
        }

        /// <summary>Quadratic Bezier as a cubic.</summary>
        public static void Quad(GraphicsPath p, float x0, float y0, float cx, float cy, float x1, float y1)
        {
            p.AddBezier(x0, y0, x0 + (cx - x0) * 2f / 3f, y0 + (cy - y0) * 2f / 3f, x1 + (cx - x1) * 2f / 3f, y1 + (cy - y1) * 2f / 3f, x1, y1);
        }

        private static void BrassPiece(Graphics g, float x, float y, float w, float h, float lx, float lw)
        {
            using (GraphicsPath p = new GraphicsPath())
            {
                RoundRect(p, x, y, w, h, 2.5f * (w / 22f));
                g.FillPath(Ink.Brush(Palette.BrassDark, 1f), p);
                GraphicsState st = g.Save();
                Ink.ClipTo(g, p, CombineMode.Intersect);
                g.FillRectangle(Ink.Brush(Palette.BrassBase, 1f), x + (lx < 0f ? -2f : w * 0.25f), y - 2f, w * 0.78f, h + 4f);
                g.FillRectangle(Ink.Brush(Palette.BrassLight, 1f), x + (lx < 0f ? w * 0.12f : w * 0.6f), y - 2f, w * 0.16f, h + 4f);
                g.Restore(st);
                g.DrawPath(Ink.Pen(Palette.Ink, lw, 1f), p);
            }
        }

        /// <summary>Draw the grenade; k = art scale, (lookX, lookY) = screen-space gaze.</summary>
        public static void Draw(Graphics g, float x, float y, float angle, float k, SlopPalette pal, bool uhoh,
            bool spoon, float sparkPhase, float lookX, float lookY)
        {
            float lw = 3.1f * k;
            GraphicsState outer = g.Save();
            g.TranslateTransform(x, y);
            g.RotateTransform(angle * 57.2957795f);
            float ca = M.Cos(-angle), sa = M.Sin(-angle);
            float lx = -0.62f * ca + 0.78f * sa;
            float ly = -0.62f * sa - 0.78f * ca;
            float lgx = lookX * ca - lookY * sa;
            float lgy = lookX * sa + lookY * ca;

            // fuse glow
            float sx = 3f * k, sy = -58f * k;
            using (GraphicsPath gp = new GraphicsPath())
            {
                gp.AddEllipse(sx - 26f * k, sy - 26f * k, 52f * k, 52f * k);
                using (PathGradientBrush pg = new PathGradientBrush(gp))
                {
                    pg.CenterPoint = new PointF(sx, sy);
                    pg.CenterColor = Color.FromArgb(200, 255, 240, 170);
                    pg.SurroundColors = new Color[] { Color.FromArgb(0, 255, 140, 0) };
                    g.FillPath(pg, gp);
                }
            }

            if (spoon) DrawSpoon(g, 9f * k, -44f * k, k, lw, 0f);

            using (GraphicsPath body = new GraphicsPath())
            using (GraphicsPath lit = new GraphicsPath())
            using (GraphicsPath core = new GraphicsPath())
            {
                Egg(body, 0f, 0f, k);
                Egg(lit, lx * 7f * k, ly * 7f * k, 0.97f * k);
                Egg(core, lx * 10f * k, ly * 10f * k, 0.95f * k);
                g.FillPath(Ink.Brush(pal.Shadow, 1f), body);
                GraphicsState st = g.Save();
                Ink.ClipTo(g, body, CombineMode.Intersect);
                g.FillPath(Ink.Brush(pal.Base, 1f), lit);
                // hatched core shadow
                GraphicsState st2 = g.Save();
                Ink.ClipTo(g, core, CombineMode.Exclude);
                Ink.Hatch(g, -40f * k, -40f * k, 40f * k, 40f * k, 5f * k, 1.3f * k, 0.5f);
                g.Restore(st2);
                float la = M.Atan2(ly, lx) + M.PI / 2f;
                Ink.FillEllipseRot(g, lx * 14f * k, ly * 15f * k, 15f * k, 11f * k, la, pal.Light, 1f);
                Ink.FillEllipseRot(g, lx * 19f * k, ly * 20f * k, 7.5f * k, 3.6f * k, la, 0xffffff, 1f);
                Ink.FillEllipse(g, lx * 10f * k + ly * 9f * k, ly * 10f * k - lx * 9f * k, 2.2f * k, 2.2f * k, 0xffffff, 1f);
                Grooves(g, lx * 1.6f * k, ly * 1.6f * k, k, pal.Light, 0.9f, 1.6f * k);
                Grooves(g, 0f, 0f, k, Palette.Ink, 0.85f, 2.2f * k);
                g.Restore(st);
                g.DrawPath(Ink.Pen(Palette.Ink, lw, 1f), body);
            }

            DrawFace(g, k, uhoh, lgx, lgy);

            BrassPiece(g, -11f * k, -44f * k, 22f * k, 11f * k, lx, lw * 0.85f);
            Pen rp = Ink.Pen(Palette.BrassDark, 1.2f * k, 1f);
            for (float i = -7f; i <= 7f; i += 3.5f) g.DrawLine(rp, i * k, -42f * k, i * k, -35f * k);
            BrassPiece(g, -14f * k, -50f * k, 28f * k, 8f * k, lx, lw * 0.85f);
            using (GraphicsPath wick = new GraphicsPath())
            {
                Quad(wick, 0f, -50f * k, -2f * k, -55f * k, sx, sy);
                g.DrawPath(Ink.Pen(Palette.Ink, 2.4f * k, 1f), wick);
            }
            DrawSpark(g, sx, sy, k, sparkPhase);
            g.Restore(outer);
        }

        private static void Grooves(Graphics g, float dx, float dy, float k, int color, float alpha, float w)
        {
            Pen p = Ink.Pen(color, w, alpha);
            g.DrawArc(p, Ink.Rect(dx, -44f * k + dy, 36f * k, 24f * k), 36f, 108f);
            g.DrawArc(p, Ink.Rect(dx, -2f * k + dy, 36f * k, 30f * k), 54f, 72f);
            g.DrawArc(p, Ink.Rect(-46f * k + dx, 3f * k + dy, 22f * k, 36f * k), -54f, 108f);
            g.DrawArc(p, Ink.Rect(46f * k + dx, 3f * k + dy, 22f * k, 36f * k), 126f, 108f);
        }

        public static void DrawSpoon(Graphics g, float px, float py, float k, float lw, float rot)
        {
            GraphicsState st = g.Save();
            g.TranslateTransform(px, py);
            if (rot != 0f) g.RotateTransform(rot * 57.2957795f);
            using (GraphicsPath p = new GraphicsPath())
            {
                p.StartFigure();
                Quad(p, -4f * k, -2f * k, 14f * k, -4f * k, 20f * k, 10f * k);
                Quad(p, 20f * k, 10f * k, 26f * k, 26f * k, 22f * k, 40f * k);
                p.AddLine(22f * k, 40f * k, 16f * k, 39f * k);
                Quad(p, 16f * k, 39f * k, 19f * k, 24f * k, 13f * k, 12f * k);
                Quad(p, 13f * k, 12f * k, 8f * k, 4f * k, -3f * k, 4f * k);
                p.CloseFigure();
                g.FillPath(Ink.Brush(Palette.SteelBase, 1f), p);
                g.DrawPath(Ink.Pen(Palette.Ink, lw * 0.85f, 1f), p);
            }
            using (GraphicsPath hl = new GraphicsPath())
            {
                Quad(hl, 2f * k, 0f, 15f * k, -1f * k, 19f * k, 12f * k);
                g.DrawPath(Ink.Pen(Palette.SteelLight, 1.4f * k, 1f), hl);
            }
            g.Restore(st);
        }

        public static void DrawRing(Graphics g, float x, float y, float k, float rot)
        {
            GraphicsState st = g.Save();
            g.TranslateTransform(x, y);
            g.RotateTransform(rot * 57.2957795f);
            RectangleF r = Ink.Rect(0f, 0f, 9f * k, 7f * k);
            g.DrawEllipse(Ink.Pen(Palette.Ink, 5.2f * k, 1f), r);
            g.DrawEllipse(Ink.Pen(Palette.SteelLight, 2.6f * k, 1f), r);
            g.Restore(st);
        }

        private static void DrawSpark(Graphics g, float x, float y, float k, float phase)
        {
            const int n = 7;
            float flick = 0.75f + 0.25f * M.Sin(phase * 1.7f) * M.Sin(phase * 0.6f + 1f);
            PointF[] pts = new PointF[n * 2];
            for (int i = 0; i < n * 2; i++)
            {
                float a = (float)i / (n * 2) * M.TAU + phase * 0.21f;
                float r = (i % 2 == 0 ? 10.5f : 4.2f) * k * flick * (i % 4 == 0 ? 1.15f : 1f);
                pts[i] = new PointF(x + M.Cos(a) * r, y + M.Sin(a) * r);
            }
            g.FillPolygon(Ink.Brush(0xffd23f, 1f), pts);
            g.DrawPolygon(Ink.Pen(Palette.Ink, 1.6f * k, 1f), pts);
            Ink.FillEllipse(g, x, y, 3f * k * flick, 3f * k * flick, 0xffffff, 1f);
        }

        private static void DrawFace(Graphics g, float k, bool uh, float lgx, float lgy)
        {
            for (int s = -1; s <= 1; s += 2) Ink.FillEllipse(g, s * 19f * k, 11f * k, 5.5f * k, 3.2f * k, 0xff5a78, 0.55f);
            float ery = (uh ? 10.5f : 9.5f) * k, erx = (uh ? 8f : 7.4f) * k;
            for (int s = -1; s <= 1; s += 2)
            {
                float ex = s * 10f * k;
                Ink.FillEllipse(g, ex, 0f, erx, ery, 0xffffff, 1f);
                Ink.StrokeEllipse(g, ex, 0f, erx, ery, 2.3f * k, Palette.Ink, 1f);
                float pr = uh ? 3.2f : 4.4f;
                float px = ex + lgx * 2.6f * k, py = lgy * 3.2f * k + 1f * k;
                Ink.FillEllipse(g, px, py, pr * k, pr * 1.3f * k, Palette.Ink, 1f);
                Ink.FillEllipse(g, px - 1.4f * k, py - 2f * k, 1.6f * k, 1.6f * k, 0xffffff, 1f);
                Ink.FillEllipse(g, px + 1.3f * k, py + 1.6f * k, 0.8f * k, 0.8f * k, 0xffffff, 1f);
            }
            Pen brow = Ink.Pen(Palette.Ink, 3f * k, 1f);
            for (int s = -1; s <= 1; s += 2)
            {
                using (GraphicsPath b = new GraphicsPath())
                {
                    if (uh) Quad(b, s * 16f * k, -12f * k, s * 11f * k, -16f * k, s * 5f * k, -14.5f * k);
                    else Quad(b, s * 17f * k, -13.5f * k, s * 11f * k, -12.5f * k, s * 5f * k, -9.5f * k);
                    g.DrawPath(brow, b);
                }
            }
            using (GraphicsPath mouth = new GraphicsPath())
            {
                if (uh) mouth.AddEllipse(Ink.Rect(0f, 15f * k, 3.6f * k, 4.6f * k));
                else
                {
                    mouth.StartFigure();
                    Quad(mouth, -7f * k, 11f * k, 0f, 22f * k, 7f * k, 11f * k);
                    Quad(mouth, 7f * k, 11f * k, 0f, 13.5f * k, -7f * k, 11f * k);
                    mouth.CloseFigure();
                }
                g.FillPath(Ink.Brush(0x5a1024, 1f), mouth);
                if (!uh)
                {
                    GraphicsState st = g.Save();
                    Ink.ClipTo(g, mouth, CombineMode.Intersect);
                    Ink.FillEllipse(g, 1f * k, 18f * k, 4f * k, 3f * k, 0xff6f8f, 1f);
                    g.Restore(st);
                }
                g.DrawPath(Ink.Pen(Palette.Ink, 2f * k, 1f), mouth);
            }
        }
    }
}
