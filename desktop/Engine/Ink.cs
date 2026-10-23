// Ink.cs
// GDI+ helpers for the inked, cel-shaded 2D art. Mirrors web/src/lib/engine/ink.ts.
// All drawing happens on the UI thread, so a few shared brushes/pens are reused
// to avoid per-primitive GDI+ allocations.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal static class Ink
    {
        private static readonly SolidBrush SharedBrush = new SolidBrush(Color.White);
        private static readonly Pen SharedPen = CreatePen();
        private static readonly GraphicsPath SharedPath = new GraphicsPath();
        private static FontFamily _comicFamily;

        private static Pen CreatePen()
        {
            Pen p = new Pen(Color.Black, 1f);
            p.LineJoin = LineJoin.Round;
            p.StartCap = LineCap.Round;
            p.EndCap = LineCap.Round;
            return p;
        }

        /// <summary>True for a usable coordinate (not NaN, not infinite, not absurdly far away).</summary>
        public static bool Ok(float v)
        {
            return !float.IsNaN(v) && v > -1e6f && v < 1e6f;
        }

        public static Color C(int rgb, float alpha)
        {
            int a = (int)(M.Clamp01(alpha) * 255f + 0.5f);
            return Color.FromArgb(a, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
        }

        public static SolidBrush Brush(int rgb, float alpha)
        {
            SharedBrush.Color = C(rgb, alpha);
            return SharedBrush;
        }

        public static Pen Pen(int rgb, float width, float alpha)
        {
            SharedPen.Color = C(rgb, alpha);
            SharedPen.Width = float.IsNaN(width) || float.IsInfinity(width) ? 1f : Math.Max(0.1f, Math.Min(width, 400f));
            return SharedPen;
        }

        /// <summary>
        /// Clip to a shape for cel shading. Returns false (and changes nothing) when the
        /// shape is degenerate or entirely outside the current clip, so an empty clip
        /// region is never created; the caller then skips the shading.
        /// </summary>
        public static bool ClipTo(Graphics g, GraphicsPath p, CombineMode mode)
        {
            RectangleF b = p.GetBounds();
            if (!Ok(b.X) || !Ok(b.Y) || !Ok(b.Width) || !Ok(b.Height) || b.Width < 0.5f || b.Height < 0.5f) return false;
            if (!g.IsVisible(b)) return false;
            g.SetClip(p, mode);
            return true;
        }

        /// <summary>A cleared, reusable path (valid until the next call).</summary>
        public static GraphicsPath Path()
        {
            SharedPath.Reset();
            return SharedPath;
        }

        public static RectangleF Rect(float cx, float cy, float rx, float ry)
        {
            // a bad number here would make GDI+ throw; draw nothing instead
            if (!Ok(cx) || !Ok(cy) || !Ok(rx) || !Ok(ry)) return new RectangleF(-100f, -100f, 0.02f, 0.02f);
            rx = Math.Max(0.01f, rx);
            ry = Math.Max(0.01f, ry);
            return new RectangleF(cx - rx, cy - ry, rx * 2f, ry * 2f);
        }

        public static void FillEllipse(Graphics g, float cx, float cy, float rx, float ry, int rgb, float alpha)
        {
            g.FillEllipse(Brush(rgb, alpha), Rect(cx, cy, rx, ry));
        }

        public static void StrokeEllipse(Graphics g, float cx, float cy, float rx, float ry, float width, int rgb, float alpha)
        {
            g.DrawEllipse(Pen(rgb, width, alpha), Rect(cx, cy, rx, ry));
        }

        /// <summary>Filled + inked ellipse rotated by `rot` radians about its centre.</summary>
        public static void InkEllipse(Graphics g, float cx, float cy, float rx, float ry, float rot, int fill, float lineW, float alpha)
        {
            GraphicsState st = g.Save();
            g.TranslateTransform(cx, cy);
            if (rot != 0f) g.RotateTransform(rot * 57.2957795f);
            RectangleF r = Rect(0f, 0f, rx, ry);
            g.FillEllipse(Brush(fill, alpha), r);
            if (lineW > 0f) g.DrawEllipse(Pen(Palette.Ink, lineW, alpha), r);
            g.Restore(st);
        }

        public static void FillEllipseRot(Graphics g, float cx, float cy, float rx, float ry, float rot, int fill, float alpha)
        {
            GraphicsState st = g.Save();
            g.TranslateTransform(cx, cy);
            if (rot != 0f) g.RotateTransform(rot * 57.2957795f);
            g.FillEllipse(Brush(fill, alpha), Rect(0f, 0f, rx, ry));
            g.Restore(st);
        }

        /// <summary>
        /// Cel-shaded inked ellipse: shadow base, lit body shifted towards the light
        /// (lx, ly in local space), light band, gloss dab and ink outline.
        /// </summary>
        public static void CelEllipse(Graphics g, float cx, float cy, float rx, float ry, int baseC, int shadow, int light,
            float lineW, float lx, float ly, bool gloss, float alpha)
        {
            GraphicsState st = g.Save();
            using (GraphicsPath clip = new GraphicsPath())
            {
                clip.AddEllipse(Rect(cx, cy, rx, ry));
                g.FillPath(Brush(shadow, alpha), clip);
                ClipTo(g, clip, CombineMode.Intersect);
                g.FillEllipse(Brush(baseC, alpha), Rect(cx + lx * rx * 0.22f, cy + ly * ry * 0.22f, rx * 0.98f, ry * 0.98f));
                g.FillEllipse(Brush(light, alpha), Rect(cx + lx * rx * 0.42f, cy + ly * ry * 0.42f, rx * 0.55f, ry * 0.5f));
                if (gloss)
                {
                    FillEllipseRot(g, cx + lx * rx * 0.5f, cy + ly * ry * 0.52f, rx * 0.2f, ry * 0.13f, M.Atan2(ly, lx) + M.PI / 2f, 0xffffff, alpha);
                }
            }
            g.Restore(st);
            g.DrawEllipse(Pen(Palette.Ink, lineW, alpha), Rect(cx, cy, rx, ry));
        }

        /// <summary>Diagonal ink hatching within the current clip.</summary>
        public static void Hatch(Graphics g, float x0, float y0, float x1, float y1, float gap, float lineW, float alpha)
        {
            Pen p = Pen(Palette.Ink, lineW, alpha);
            float h = y1 - y0;
            for (float x = x0 - h; x < x1; x += gap)
            {
                g.DrawLine(p, x, y1, x + h, y0);
            }
        }

        /// <summary>Comic display font family (Impact, falling back to Arial Black / Arial).</summary>
        public static FontFamily ComicFamily
        {
            get
            {
                if (_comicFamily != null) return _comicFamily;
                string[] names = new string[] { "Impact", "Arial Black", "Bahnschrift", "Arial" };
                for (int i = 0; i < names.Length; i++)
                {
                    try
                    {
                        _comicFamily = new FontFamily(names[i]);
                        return _comicFamily;
                    }
                    catch (ArgumentException)
                    {
                    }
                }
                _comicFamily = FontFamily.GenericSansSerif;
                return _comicFamily;
            }
        }
    }
}
