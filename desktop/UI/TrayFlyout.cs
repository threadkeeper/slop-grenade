// TrayFlyout.cs
// The brass-and-ink control panel that pops above the tray icon: two daily
// "% AI-written" gauges (incoming / outgoing, reset at 00:00), lever toggles,
// sound controls, squeegee plates and launch buttons. Fully custom painted.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace SlopGrenadeDesktop
{
    internal sealed class TrayFlyout : Form
    {
        private sealed class Hit
        {
            public RectangleF Rect;
            public string Id;
        }

        private readonly Settings _settings;
        private readonly Func<bool> _getStartup;
        private readonly Action<bool> _setStartup;
        private readonly Action<string> _command;
        private readonly List<Hit> _hits = new List<Hit>();
        private readonly float _f;
        private Bitmap _backdrop;
        private string _hover;
        private string _pressed;
        private int _recPct, _recCount, _sentPct, _sentCount;
        private float _needleIn, _needleOut, _velIn, _velOut;
        private readonly System.Windows.Forms.Timer _anim;

        public TrayFlyout(Settings settings, Func<bool> getStartup, Action<bool> setStartup, Action<string> command)
        {
            _settings = settings;
            _getStartup = getStartup;
            _setStartup = setStartup;
            _command = command;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            DoubleBuffered = true;
            KeyPreview = true;
            using (Graphics g = CreateGraphics()) _f = Math.Max(1f, g.DpiX / 96f);
            Width = (int)(360 * _f);
            Height = (int)(586 * _f);
            using (GraphicsPath plate = SteampunkArt.Plate(new RectangleF(0f, 0f, Width, Height), 14f * _f))
                Region = new Region(plate);
            _anim = new System.Windows.Forms.Timer();
            _anim.Interval = 30;
            _anim.Tick += OnAnim;
            Deactivate += delegate
            {
                LastAutoHide = DateTime.UtcNow;
                Hide();
            };
            KeyDown += delegate(object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Hide(); };
        }

        /// <summary>When the panel last closed because it lost focus (UTC).</summary>
        public DateTime LastAutoHide = DateTime.MinValue;

        /// <summary>Daily share (0-100) of AI-written messages and message counts per direction.</summary>
        public void UpdateMetrics(int recPct, int recCount, int sentPct, int sentCount)
        {
            _recPct = recPct;
            _recCount = recCount;
            _sentPct = sentPct;
            _sentCount = sentCount;
            if (Visible) _anim.Start();
        }

        public void ShowAboveTray()
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Left = wa.Right - Width - (int)(12 * _f);
            Top = wa.Bottom - Height - (int)(12 * _f);
            // needles swing up from zero every time the panel opens
            _needleIn = 0f;
            _needleOut = 0f;
            _velIn = 0f;
            _velOut = 0f;
            Show();
            Activate();
            _anim.Start();
            Invalidate();
        }

        private void OnAnim(object sender, EventArgs e)
        {
            bool moving = Spring(ref _needleIn, ref _velIn, _recPct) | Spring(ref _needleOut, ref _velOut, _sentPct);
            Invalidate();
            if (!moving) _anim.Stop();
        }

        private static bool Spring(ref float x, ref float v, float target)
        {
            float dt = 0.03f;
            float a = (target - x) * 90f - v * 9f;
            v += a * dt;
            x += v * dt;
            if (Math.Abs(target - x) < 0.05f && Math.Abs(v) < 0.05f)
            {
                x = target;
                v = 0f;
                return false;
            }
            return true;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            float f = _f;
            if (_backdrop == null || _backdrop.Width != Width || _backdrop.Height != Height)
            {
                if (_backdrop != null) _backdrop.Dispose();
                _backdrop = SteampunkArt.Backdrop(Width, Height, f);
            }
            g.DrawImageUnscaled(_backdrop, 0, 0);
            _hits.Clear();

            // brass frame
            RectangleF outer = new RectangleF(1f, 1f, Width - 2f, Height - 2f);
            using (GraphicsPath frame = SteampunkArt.Plate(outer, 14f * f))
            using (GraphicsPath inner = SteampunkArt.Plate(RectangleF.Inflate(outer, -9f * f, -9f * f), 9f * f))
            {
                using (GraphicsPath ring = new GraphicsPath(FillMode.Alternate))
                {
                    ring.AddPath(frame, false);
                    ring.AddPath(inner, false);
                    SteampunkArt.Brass(g, ring, outer, 2.4f * f, false);
                }
                using (Pen pen = new Pen(SteampunkArt.InkC, 2f * f)) g.DrawPath(pen, inner);
            }
            float[] rx = new float[] { 18f, Width / f - 18f };
            float[] ry = new float[] { 18f, Height / f / 2f, Height / f - 18f };
            foreach (float x in rx) foreach (float y in ry) SteampunkArt.Rivet(g, x * f, y * f, 4f * f);

            // title plate
            RectangleF title = new RectangleF(28f * f, 20f * f, Width - 56f * f, 52f * f);
            using (GraphicsPath tp = SteampunkArt.Plate(title, 8f * f)) SteampunkArt.Brass(g, tp, title, 2.2f * f, false);
            SteampunkArt.Rivet(g, title.Left + 10f * f, title.Top + title.Height / 2f, 3f * f);
            SteampunkArt.Rivet(g, title.Right - 10f * f, title.Top + title.Height / 2f, 3f * f);
            SteampunkArt.ComicText(g, "SLOP GRENADE", 30f * f, new RectangleF(title.X, title.Y - 2f * f, title.Width, title.Height), -3f,
                Color.FromArgb(255, 245, 190), Color.FromArgb(255, 110, 30), 2.2f * f);
            SteampunkArt.Engraved(g, "DAILY % AI-WRITTEN  \u00b7  RESETS AT 00:00", 10.5f * f, FontStyle.Bold,
                new RectangleF(20f * f, 74f * f, Width - 40f * f, 18f * f), SteampunkArt.BrassL, StringAlignment.Center);

            // gauges
            SteampunkArt.Gauge(g, new PointF(98f * f, 170f * f), 70f * f, _needleIn, "INCOMING", _recCount + " msgs", f);
            SteampunkArt.Gauge(g, new PointF(Width - 98f * f, 170f * f), 70f * f, _needleOut, "OUTGOING", _sentCount + " msgs", f);
            SteampunkArt.Engraved(g, _recPct + "% AI", 13f * f, FontStyle.Bold, new RectangleF(28f * f, 242f * f, 140f * f, 18f * f), SteampunkArt.Cream, StringAlignment.Center);
            SteampunkArt.Engraved(g, _sentPct + "% AI", 13f * f, FontStyle.Bold, new RectangleF(Width - 168f * f, 242f * f, 140f * f, 18f * f), SteampunkArt.Cream, StringAlignment.Center);

            // toggles
            float y0 = 272f * f;
            float rowH = 30f * f;
            Row(g, "startup", "Launch at Windows sign-in", _getStartup(), y0);
            Row(g, "teams", "Watch Microsoft Teams", _settings.MonitorTeams, y0 + rowH);
            Row(g, "outlook", "Watch Outlook mail", _settings.MonitorOutlook, y0 + rowH * 2f);
            Row(g, "slopfx", "Slop FX: grenades & cannon", _settings.SlopEffects, y0 + rowH * 3f);
            Row(g, "calmfx", "Calm FX: fruit, smoke, twinkles", _settings.CalmEffects, y0 + rowH * 4f);
            Row(g, "sound", "Sound FX (explosions are loud!)", _settings.SoundEnabled, y0 + rowH * 5f);

            // volume
            float vy = y0 + rowH * 6f + 2f * f;
            SteampunkArt.Engraved(g, "Volume", 13f * f, FontStyle.Regular, new RectangleF(30f * f, vy, 120f * f, 24f * f), SteampunkArt.Cream, StringAlignment.Near);
            string[] vols = new string[] { "SOFT", "MED", "LOUD" };
            int[] levels = new int[] { 35, 70, 100 };
            for (int i = 0; i < 3; i++)
            {
                RectangleF r = new RectangleF(Width - (30f + (3 - i) * 64f) * f, vy, 58f * f, 24f * f);
                bool sel = Math.Abs(_settings.Volume - levels[i]) < 18;
                Button(g, "vol" + levels[i], vols[i], r, sel, 13f * f);
            }

            // action plates
            float by = vy + 40f * f;
            float bw = (Width - 76f * f) / 2f;
            Button(g, "squeegee-left", "\u25c4 SQUEEGEE", new RectangleF(30f * f, by, bw, 38f * f), false, 17f * f);
            Button(g, "squeegee-right", "SQUEEGEE \u25ba", new RectangleF(46f * f + bw, by, bw, 38f * f), false, 17f * f);
            float bw3 = (Width - 84f * f) / 3f;
            float by2 = by + 48f * f;
            Button(g, "dashboard", "DASHBOARD", new RectangleF(30f * f, by2, bw3, 36f * f), false, 14f * f);
            Button(g, "test", "TEST FIRE!", new RectangleF(42f * f + bw3, by2, bw3, 36f * f), false, 14f * f);
            Button(g, "quit", "QUIT", new RectangleF(54f * f + bw3 * 2f, by2, bw3, 36f * f), false, 14f * f);
        }

        private void Row(Graphics g, string id, string label, bool on, float y)
        {
            float f = _f;
            RectangleF hit = new RectangleF(24f * f, y, Width - 48f * f, 28f * f);
            bool hover = _hover == id;
            if (hover)
            {
                using (SolidBrush hb = new SolidBrush(Color.FromArgb(40, 255, 210, 120))) g.FillRectangle(hb, hit);
            }
            SteampunkArt.Engraved(g, label, 13.5f * f, FontStyle.Regular, new RectangleF(32f * f, y, Width - 140f * f, 28f * f),
                on ? SteampunkArt.Cream : Color.FromArgb(170, 150, 120), StringAlignment.Near);
            SteampunkArt.Toggle(g, new RectangleF(Width - 92f * f, y + 3f * f, 60f * f, 22f * f), on, hover);
            _hits.Add(new Hit { Rect = hit, Id = id });
        }

        private void Button(Graphics g, string id, string label, RectangleF r, bool selected, float size)
        {
            bool hover = _hover == id;
            bool down = _pressed == id;
            RectangleF rr = down ? new RectangleF(r.X, r.Y + 2f * _f, r.Width, r.Height) : r;
            using (GraphicsPath p = SteampunkArt.Plate(rr, 6f * _f)) SteampunkArt.Brass(g, p, rr, 2f * _f, hover || selected);
            SteampunkArt.Rivet(g, rr.Left + 7f * _f, rr.Top + 7f * _f, 2.2f * _f);
            SteampunkArt.Rivet(g, rr.Right - 7f * _f, rr.Top + 7f * _f, 2.2f * _f);
            Color top = selected ? Color.FromArgb(255, 255, 230) : Color.FromArgb(255, 245, 205);
            Color bottom = selected ? Color.FromArgb(255, 150, 40) : Color.FromArgb(244, 196, 120);
            SteampunkArt.ComicText(g, label, size, rr, -2f, top, bottom, 1.4f * _f);
            _hits.Add(new Hit { Rect = r, Id = id });
        }

        private string HitTest(Point p)
        {
            for (int i = _hits.Count - 1; i >= 0; i--) if (_hits[i].Rect.Contains(p)) return _hits[i].Id;
            return null;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            string h = HitTest(e.Location);
            if (h != _hover)
            {
                _hover = h;
                Cursor = h != null ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hover = null;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            _pressed = HitTest(e.Location);
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            string id = HitTest(e.Location);
            string pressed = _pressed;
            _pressed = null;
            Invalidate();
            if (id == null || id != pressed) return;
            switch (id)
            {
                case "startup": _setStartup(!_getStartup()); break;
                case "teams": _settings.MonitorTeams = !_settings.MonitorTeams; Changed(); break;
                case "outlook": _settings.MonitorOutlook = !_settings.MonitorOutlook; Changed(); break;
                case "slopfx": _settings.SlopEffects = !_settings.SlopEffects; Changed(); break;
                case "calmfx": _settings.CalmEffects = !_settings.CalmEffects; Changed(); break;
                case "sound": _settings.SoundEnabled = !_settings.SoundEnabled; Changed(); break;
                case "vol35": _settings.Volume = 35; Changed(); break;
                case "vol70": _settings.Volume = 70; Changed(); break;
                case "vol100": _settings.Volume = 100; Changed(); break;
                case "dashboard": Hide(); _command("dashboard"); break;
                default: _command(id); break;
            }
            Invalidate();
        }

        private void Changed()
        {
            _settings.Save();
            _command("settings");
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _anim.Dispose();
                if (_backdrop != null) _backdrop.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
