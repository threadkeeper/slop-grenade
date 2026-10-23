// SteampunkArt.cs
// Shared GDI+ painting for the brass-and-ink control panel (tray flyout) and
// the tray icon. Matches the dashboard's steampunk / inked comic theme.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace SlopGrenadeDesktop
{
    internal static class SteampunkArt
    {
        public static readonly Color InkC = Color.FromArgb(27, 20, 32);
        public static readonly Color Cream = Color.FromArgb(243, 230, 196);
        public static readonly Color BrassD = Color.FromArgb(138, 90, 28);
        public static readonly Color BrassB = Color.FromArgb(227, 169, 59);
        public static readonly Color BrassL = Color.FromArgb(255, 225, 140);
        public static readonly Color Copper = Color.FromArgb(184, 104, 58);
        public static readonly Color Walnut0 = Color.FromArgb(42, 26, 18);
        public static readonly Color Walnut1 = Color.FromArgb(66, 40, 25);

        private static FontFamily _serif;

        public static FontFamily Serif
        {
            get
            {
                if (_serif != null) return _serif;
                string[] names = new string[] { "Georgia", "Book Antiqua", "Palatino Linotype", "Times New Roman" };
                for (int i = 0; i < names.Length; i++)
                {
                    try { _serif = new FontFamily(names[i]); return _serif; }
                    catch (ArgumentException) { }
                }
                _serif = FontFamily.GenericSerif;
                return _serif;
            }
        }

        /// <summary>Chamfered plate outline (cut corners).</summary>
        public static GraphicsPath Plate(RectangleF r, float cut)
        {
            GraphicsPath p = new GraphicsPath();
            p.AddPolygon(new PointF[]
            {
                new PointF(r.Left + cut, r.Top), new PointF(r.Right - cut, r.Top), new PointF(r.Right, r.Top + cut),
                new PointF(r.Right, r.Bottom - cut), new PointF(r.Right - cut, r.Bottom), new PointF(r.Left + cut, r.Bottom),
                new PointF(r.Left, r.Bottom - cut), new PointF(r.Left, r.Top + cut)
            });
            return p;
        }

        public static void Brass(Graphics g, GraphicsPath p, RectangleF r, float ink, bool hot)
        {
            using (LinearGradientBrush lg = new LinearGradientBrush(new RectangleF(r.X, r.Y - 1f, r.Width, r.Height + 2f), BrassL, BrassD, LinearGradientMode.Vertical))
            {
                ColorBlend cb = new ColorBlend(4);
                cb.Colors = hot
                    ? new Color[] { Color.FromArgb(255, 240, 170), Color.FromArgb(255, 205, 90), BrassB, BrassD }
                    : new Color[] { BrassL, BrassB, Color.FromArgb(196, 138, 46), BrassD };
                cb.Positions = new float[] { 0f, 0.35f, 0.7f, 1f };
                lg.InterpolationColors = cb;
                g.FillPath(lg, p);
            }
            using (Pen hl = new Pen(Color.FromArgb(120, 255, 248, 220), Math.Max(1f, ink * 0.5f)))
            {
                g.DrawLine(hl, r.Left + ink * 2f, r.Top + ink * 1.4f, r.Right - ink * 2f, r.Top + ink * 1.4f);
            }
            using (Pen pen = new Pen(InkC, ink))
            {
                pen.LineJoin = LineJoin.Round;
                g.DrawPath(pen, p);
            }
        }

        public static void Rivet(Graphics g, float x, float y, float r)
        {
            using (GraphicsPath p = new GraphicsPath())
            {
                p.AddEllipse(x - r, y - r, r * 2f, r * 2f);
                using (PathGradientBrush pg = new PathGradientBrush(p))
                {
                    pg.CenterPoint = new PointF(x - r * 0.35f, y - r * 0.35f);
                    pg.CenterColor = BrassL;
                    pg.SurroundColors = new Color[] { BrassD };
                    g.FillPath(pg, p);
                }
                using (Pen pen = new Pen(InkC, Math.Max(1f, r * 0.35f))) g.DrawPath(pen, p);
            }
        }

        /// <summary>Comic text with ink outline, extrusion and a hot gradient fill.</summary>
        public static void ComicText(Graphics g, string text, float size, RectangleF box, float rot, Color top, Color bottom, float ink)
        {
            using (GraphicsPath path = new GraphicsPath())
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                path.AddString(text, Ink.ComicFamily, (int)FontStyle.Italic, size, new PointF(0f, 0f), sf);
                GraphicsState st = g.Save();
                g.TranslateTransform(box.X + box.Width / 2f, box.Y + box.Height / 2f);
                g.RotateTransform(rot);
                GraphicsState s2 = g.Save();
                g.TranslateTransform(ink * 0.9f, ink * 1.1f);
                using (SolidBrush sb = new SolidBrush(InkC)) g.FillPath(sb, path);
                g.Restore(s2);
                using (Pen pen = new Pen(InkC, ink * 2f))
                {
                    pen.LineJoin = LineJoin.Round;
                    g.DrawPath(pen, path);
                }
                RectangleF b = path.GetBounds();
                using (LinearGradientBrush lg = new LinearGradientBrush(new RectangleF(b.X, b.Y - 1f, Math.Max(1f, b.Width), b.Height + 2f), top, bottom, LinearGradientMode.Vertical))
                {
                    g.FillPath(lg, path);
                }
                g.Restore(st);
            }
        }

        /// <summary>Engraved serif label (dark shadow below, light text).</summary>
        public static void Engraved(Graphics g, string text, float size, FontStyle style, RectangleF box, Color color, StringAlignment align)
        {
            using (Font f = new Font(Serif, size, style, GraphicsUnit.Pixel))
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = align;
                sf.LineAlignment = StringAlignment.Center;
                sf.Trimming = StringTrimming.EllipsisCharacter;
                sf.FormatFlags = StringFormatFlags.NoWrap;
                using (SolidBrush sh = new SolidBrush(Color.FromArgb(170, 10, 6, 4)))
                    g.DrawString(text, f, sh, new RectangleF(box.X + 1f, box.Y + 1.2f, box.Width, box.Height), sf);
                using (SolidBrush b = new SolidBrush(color)) g.DrawString(text, f, b, box, sf);
            }
        }

        /// <summary>Walnut + leather backdrop with subtle grain, pre-rendered once.</summary>
        public static Bitmap Backdrop(int w, int h, float f)
        {
            Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (LinearGradientBrush lg = new LinearGradientBrush(new Rectangle(0, 0, w, h), Walnut1, Walnut0, 75f))
                    g.FillRectangle(lg, 0, 0, w, h);
                Rng rng = new Rng(4242);
                for (int i = 0; i < h * 2; i++)
                {
                    float y = rng.Range(0f, h);
                    float a = rng.Range(6f, 22f);
                    using (Pen p = new Pen(Color.FromArgb((int)a, rng.Chance(0.5f) ? 0 : 255, 200, 150), rng.Range(0.6f, 1.6f) * f))
                    {
                        float x0 = rng.Range(-40f, w);
                        g.DrawBezier(p, x0, y, x0 + 40f * f, y + rng.Range(-3f, 3f) * f, x0 + 90f * f, y + rng.Range(-3f, 3f) * f, x0 + 140f * f, y + rng.Range(-2f, 2f) * f);
                    }
                }
                using (GraphicsPath vig = new GraphicsPath())
                {
                    vig.AddEllipse(-w * 0.25f, -h * 0.2f, w * 1.5f, h * 1.4f);
                    using (PathGradientBrush pg = new PathGradientBrush(vig))
                    {
                        pg.CenterColor = Color.FromArgb(0, 0, 0, 0);
                        pg.SurroundColors = new Color[] { Color.FromArgb(150, 8, 4, 2) };
                        g.FillRectangle(pg, 0, 0, w, h);
                    }
                }
            }
            return bmp;
        }

        /// <summary>Brass pressure gauge with a cream dial, zones, ticks and needle.</summary>
        public static void Gauge(Graphics g, PointF c, float r, float value, string caption, string sub, float f)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            // bezel
            using (GraphicsPath bez = new GraphicsPath())
            {
                bez.AddEllipse(c.X - r, c.Y - r, r * 2f, r * 2f);
                using (LinearGradientBrush lg = new LinearGradientBrush(new RectangleF(c.X - r, c.Y - r - 1f, r * 2f, r * 2f + 2f), BrassL, BrassD, 60f))
                    g.FillPath(lg, bez);
                using (Pen pen = new Pen(InkC, 2.6f * f)) g.DrawPath(pen, bez);
            }
            float fr = r * 0.82f;
            RectangleF face = new RectangleF(c.X - fr, c.Y - fr, fr * 2f, fr * 2f);
            using (GraphicsPath fp = new GraphicsPath())
            {
                fp.AddEllipse(face);
                using (PathGradientBrush pg = new PathGradientBrush(fp))
                {
                    pg.CenterPoint = new PointF(c.X - fr * 0.2f, c.Y - fr * 0.3f);
                    pg.CenterColor = Color.FromArgb(255, 250, 238);
                    pg.SurroundColors = new Color[] { Color.FromArgb(222, 200, 152) };
                    g.FillPath(pg, fp);
                }
                using (Pen pen = new Pen(InkC, 1.8f * f)) g.DrawPath(pen, fp);
            }
            // zones: 0-40 green, 40-70 amber, 70-100 red (sweep 270 deg starting at 135)
            float zr = fr * 0.78f;
            RectangleF zone = new RectangleF(c.X - zr, c.Y - zr, zr * 2f, zr * 2f);
            using (Pen zp = new Pen(Color.FromArgb(90, 168, 70), 5f * f))
            {
                g.DrawArc(zp, zone, 135f, 108f);
                zp.Color = Color.FromArgb(230, 170, 40);
                g.DrawArc(zp, zone, 243f, 81f);
                zp.Color = Color.FromArgb(206, 52, 40);
                g.DrawArc(zp, zone, 324f, 81f);
            }
            using (Pen tick = new Pen(InkC, 1.2f * f))
            using (Font tf = new Font(Serif, 8.5f * f, FontStyle.Bold, GraphicsUnit.Pixel))
            using (SolidBrush tb = new SolidBrush(InkC))
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                for (int i = 0; i <= 20; i++)
                {
                    float a = (135f + i * 13.5f) * M.PI / 180f;
                    bool major = i % 4 == 0;
                    float r0 = fr * (major ? 0.62f : 0.68f), r1 = fr * 0.74f;
                    tick.Width = (major ? 2f : 1f) * f;
                    g.DrawLine(tick, c.X + M.Cos(a) * r0, c.Y + M.Sin(a) * r0, c.X + M.Cos(a) * r1, c.Y + M.Sin(a) * r1);
                    if (major)
                    {
                        float rt = fr * 0.47f;
                        g.DrawString((i * 5).ToString(), tf, tb, c.X + M.Cos(a) * rt, c.Y + M.Sin(a) * rt, sf);
                    }
                }
            }
            using (Font cf = new Font(Serif, 8f * f, FontStyle.Italic | FontStyle.Bold, GraphicsUnit.Pixel))
            using (SolidBrush cb = new SolidBrush(Color.FromArgb(120, 70, 40)))
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                g.DrawString(caption, cf, cb, c.X, c.Y + fr * 0.28f, sf);
                g.DrawString(sub, cf, cb, c.X, c.Y + fr * 0.5f, sf);
            }
            // needle
            float v = M.Clamp(value, 0f, 100f);
            float na = (135f + v * 2.7f) * M.PI / 180f;
            float nl = fr * 0.8f;
            PointF tip = new PointF(c.X + M.Cos(na) * nl, c.Y + M.Sin(na) * nl);
            PointF tail = new PointF(c.X - M.Cos(na) * fr * 0.18f, c.Y - M.Sin(na) * fr * 0.18f);
            float px = -M.Sin(na) * 3.2f * f, py = M.Cos(na) * 3.2f * f;
            PointF[] needle = new PointF[] { tip, new PointF(c.X + px, c.Y + py), tail, new PointF(c.X - px, c.Y - py) };
            using (SolidBrush nb = new SolidBrush(Color.FromArgb(198, 36, 36))) g.FillPolygon(nb, needle);
            using (Pen np = new Pen(InkC, 1.4f * f)) g.DrawPolygon(np, needle);
            Rivet(g, c.X, c.Y, 5.5f * f);
            // glass glare
            using (GraphicsPath gl = new GraphicsPath())
            {
                gl.AddArc(c.X - fr * 0.86f, c.Y - fr * 0.86f, fr * 1.72f, fr * 1.72f, 200f, 70f);
                using (Pen gp = new Pen(Color.FromArgb(90, 255, 255, 255), 4f * f)) g.DrawPath(gp, gl);
            }
        }

        /// <summary>Brass toggle lever (on = lever up and lit lamp).</summary>
        public static void Toggle(Graphics g, RectangleF r, bool on, bool hover)
        {
            float f = r.Height / 22f;
            RectangleF baseR = new RectangleF(r.X, r.Y + r.Height * 0.2f, r.Width, r.Height * 0.6f);
            using (GraphicsPath p = Plate(baseR, 4f * f)) Brass(g, p, baseR, 1.6f * f, hover);
            float knobX = on ? baseR.Right - baseR.Height * 0.55f : baseR.Left + baseR.Height * 0.55f;
            float ky = baseR.Y + baseR.Height / 2f;
            using (Pen slot = new Pen(Color.FromArgb(60, 30, 10), 3f * f)) g.DrawLine(slot, baseR.Left + 7f * f, ky, baseR.Right - 7f * f, ky);
            using (GraphicsPath k = new GraphicsPath())
            {
                float kr = r.Height * 0.42f;
                k.AddEllipse(knobX - kr, ky - kr, kr * 2f, kr * 2f);
                using (PathGradientBrush pg = new PathGradientBrush(k))
                {
                    pg.CenterPoint = new PointF(knobX - kr * 0.3f, ky - kr * 0.35f);
                    pg.CenterColor = on ? Color.FromArgb(255, 255, 200) : Color.FromArgb(220, 220, 220);
                    pg.SurroundColors = new Color[] { on ? Color.FromArgb(255, 140, 20) : Color.FromArgb(90, 90, 96) };
                    g.FillPath(pg, k);
                }
                using (Pen pen = new Pen(InkC, 1.6f * f)) g.DrawPath(pen, k);
            }
        }

        /// <summary>The pink cartoon grenade used for the tray icon.</summary>
        public static Bitmap GrenadeIcon(int size)
        {
            Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                float k = size / 32f;
                Grenade.Draw(g, 16f * k, 19f * k, -0.25f, 0.33f * k, Palette.Pink, false, true, 3f, 0.3f, 0.2f);
            }
            return bmp;
        }
    }
}
