// OverlayForm.cs
// Topmost, click-through, per-pixel-alpha window covering the primary monitor.
// GDI+ draws straight into a DIB section; only dirty rectangles are cleared,
// redrawn and presented (UpdateLayeredWindowIndirect). The game loop sleeps
// completely when nothing is moving.

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SlopGrenadeDesktop
{
    internal sealed class OverlayForm : Form
    {
        private World _world;
        private int _w, _h;
        private IntPtr _memDc = IntPtr.Zero;
        private IntPtr _dib = IntPtr.Zero;
        private IntPtr _oldBmp = IntPtr.Zero;
        private IntPtr _bits = IntPtr.Zero;
        private Bitmap _surface;
        private Graphics _g;
        private readonly System.Windows.Forms.Timer _timer;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private long _lastTicks;
        private bool _highRes;
        private bool _needFull = true;
        private int _frame;
        private DirtyRegion _dirty;
        private readonly SolidBrush _clearBrush = new SolidBrush(Color.FromArgb(0, 0, 0, 0));
        private IntPtr _ptDst, _size, _ptSrc, _blend, _rc;
        private readonly float _flyDelay;

        public event Action<int, int> SlopCountsChanged;
        private int _lastLeft = -1, _lastRight = -1;

        public ISfxSink Sfx { get; set; }

        public OverlayForm(float flyDelaySeconds)
        {
            _flyDelay = flyDelaySeconds;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Rectangle screen = Screen.PrimaryScreen.Bounds;
            Bounds = screen;
            _timer = new System.Windows.Forms.Timer();
            _timer.Interval = 15;
            _timer.Tick += OnTick;
            _ptDst = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeMethods.POINT)));
            _ptSrc = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeMethods.POINT)));
            _size = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeMethods.SIZE)));
            _blend = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeMethods.BLENDFUNCTION)));
            _rc = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeMethods.RECT)));
            BuildSurface(screen);
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        }

        public World World { get { return _world; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= NativeMethods.WS_EX_LAYERED | NativeMethods.WS_EX_TRANSPARENT | NativeMethods.WS_EX_TOPMOST
                    | NativeMethods.WS_EX_TOOLWINDOW | NativeMethods.WS_EX_NOACTIVATE;
                return cp;
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        private void BuildSurface(Rectangle screen)
        {
            ReleaseSurface();
            _w = Math.Max(1, screen.Width);
            _h = Math.Max(1, screen.Height);
            IntPtr screenDc = NativeMethods.GetDC(IntPtr.Zero);
            try
            {
                NativeMethods.BITMAPINFOHEADER bmi = new NativeMethods.BITMAPINFOHEADER();
                bmi.biSize = Marshal.SizeOf(typeof(NativeMethods.BITMAPINFOHEADER));
                bmi.biWidth = _w;
                bmi.biHeight = -_h;
                bmi.biPlanes = 1;
                bmi.biBitCount = 32;
                bmi.biCompression = 0;
                _dib = NativeMethods.CreateDIBSection(screenDc, ref bmi, NativeMethods.DIB_RGB_COLORS, out _bits, IntPtr.Zero, 0);
                _memDc = NativeMethods.CreateCompatibleDC(screenDc);
                _oldBmp = NativeMethods.SelectObject(_memDc, _dib);
            }
            finally
            {
                NativeMethods.ReleaseDC(IntPtr.Zero, screenDc);
            }
            _surface = new Bitmap(_w, _h, _w * 4, PixelFormat.Format32bppPArgb, _bits);
            _g = Graphics.FromImage(_surface);
            _g.SmoothingMode = SmoothingMode.AntiAlias;
            _g.PixelOffsetMode = PixelOffsetMode.Half;
            _g.InterpolationMode = InterpolationMode.NearestNeighbor;
            _g.CompositingQuality = CompositingQuality.HighSpeed;
            if (_world != null) _world.Dispose();
            _world = new World(_w, _h, _flyDelay, (uint)Environment.TickCount);
            _world.Sfx = Sfx;
            _dirty = new DirtyRegion(_w, _h);
            _needFull = true;
        }

        private void ReleaseSurface()
        {
            if (_g != null) { _g.Dispose(); _g = null; }
            if (_surface != null) { _surface.Dispose(); _surface = null; }
            if (_memDc != IntPtr.Zero)
            {
                if (_oldBmp != IntPtr.Zero) NativeMethods.SelectObject(_memDc, _oldBmp);
                NativeMethods.DeleteDC(_memDc);
                _memDc = IntPtr.Zero;
            }
            if (_dib != IntPtr.Zero) { NativeMethods.DeleteObject(_dib); _dib = IntPtr.Zero; }
        }

        private void OnDisplayChanged(object sender, EventArgs e)
        {
            if (IsDisposed) return;
            BeginInvoke(new Action(delegate
            {
                Rectangle screen = Screen.PrimaryScreen.Bounds;
                Bounds = screen;
                BuildSurface(screen);
                Wake();
            }));
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Wake();
        }

        /// <summary>Starts the game loop (no-op when already running).</summary>
        public void Wake()
        {
            if (_world != null) _world.Sfx = Sfx;
            if (_timer.Enabled) return;
            if (!_highRes) { NativeMethods.timeBeginPeriod(1); _highRes = true; }
            _lastTicks = _clock.ElapsedTicks;
            _timer.Start();
        }

        private void Sleep()
        {
            _timer.Stop();
            if (_highRes) { NativeMethods.timeEndPeriod(1); _highRes = false; }
        }

        public void Trigger(EffectTier tier, Side side)
        {
            _world.Trigger(tier, side);
            Wake();
        }

        public void TriggerLater(float delay, EffectTier tier, Side side)
        {
            _world.TriggerLater(delay, tier, side);
            Wake();
        }

        public void Squeegee(Side side)
        {
            _world.SqueegeeSide(side);
            Wake();
        }

        public void GetSlopCounts(out int left, out int right)
        {
            _world.SlopCounts(out left, out right);
        }

        private void OnTick(object sender, EventArgs e)
        {
            if (!IsHandleCreated || IsDisposed || _world == null) return;
            long now = _clock.ElapsedTicks;
            float dt = (float)((now - _lastTicks) / (double)Stopwatch.Frequency);
            _frame++;
            // calm scenes (drips, flies, lingering smoke) run at ~30 fps
            if (_world.IsCalm && !_needFull && (_frame & 1) == 1) return;
            _lastTicks = now;
            try
            {
                _world.Update(dt);
                _world.PrepareFrame();
                _dirty.Clear();
                if (_needFull) { _dirty.AddFull(); _needFull = false; }
                _world.CollectDirty(_dirty);
                if (!_dirty.IsEmpty) RenderAndPresent();
            }
            catch (Exception ex)
            {
                Trace.WriteLine("Slop Grenade overlay frame failed: " + ex);
            }
            int l, r;
            _world.SlopCounts(out l, out r);
            if ((l != _lastLeft || r != _lastRight) && SlopCountsChanged != null)
            {
                _lastLeft = l;
                _lastRight = r;
                SlopCountsChanged(l, r);
            }
            if (_world.IsIdle && _dirty.IsEmpty) Sleep();
        }

        private void RenderAndPresent()
        {
            bool full = _dirty.IsFull;
            foreach (Rectangle rc in _dirty.Rects())
            {
                GraphicsState st = _g.Save();
                _g.SetClip(rc);
                _g.CompositingMode = CompositingMode.SourceCopy;
                _g.FillRectangle(_clearBrush, rc);
                _g.CompositingMode = CompositingMode.SourceOver;
                _world.Render(_g, rc);
                _g.Restore(st);
            }
            _g.Flush(FlushIntention.Sync);
            NativeMethods.GdiFlush();
            if (full) Present(null);
            else foreach (Rectangle rc in _dirty.Rects()) Present(rc);
        }

        private void Present(Rectangle? dirty)
        {
            NativeMethods.POINT dst = new NativeMethods.POINT(Left, Top);
            NativeMethods.POINT src = new NativeMethods.POINT(0, 0);
            NativeMethods.SIZE size = new NativeMethods.SIZE(_w, _h);
            NativeMethods.BLENDFUNCTION blend = new NativeMethods.BLENDFUNCTION();
            blend.BlendOp = NativeMethods.AC_SRC_OVER;
            blend.SourceConstantAlpha = 255;
            blend.AlphaFormat = NativeMethods.AC_SRC_ALPHA;
            Marshal.StructureToPtr(dst, _ptDst, false);
            Marshal.StructureToPtr(src, _ptSrc, false);
            Marshal.StructureToPtr(size, _size, false);
            Marshal.StructureToPtr(blend, _blend, false);
            NativeMethods.UPDATELAYEREDWINDOWINFO info = new NativeMethods.UPDATELAYEREDWINDOWINFO();
            info.cbSize = Marshal.SizeOf(typeof(NativeMethods.UPDATELAYEREDWINDOWINFO));
            info.hdcDst = IntPtr.Zero;
            info.pptDst = _ptDst;
            info.psize = _size;
            info.hdcSrc = _memDc;
            info.pptSrc = _ptSrc;
            info.crKey = 0;
            info.pblend = _blend;
            info.dwFlags = (uint)NativeMethods.ULW_ALPHA;
            info.prcDirty = IntPtr.Zero;
            if (dirty.HasValue)
            {
                NativeMethods.RECT r = new NativeMethods.RECT();
                r.left = dirty.Value.Left;
                r.top = dirty.Value.Top;
                r.right = dirty.Value.Right;
                r.bottom = dirty.Value.Bottom;
                Marshal.StructureToPtr(r, _rc, false);
                info.prcDirty = _rc;
            }
            if (!NativeMethods.UpdateLayeredWindowIndirect(Handle, ref info))
            {
                // fall back to a full classic update
                NativeMethods.UpdateLayeredWindow(Handle, IntPtr.Zero, ref dst, ref size, _memDc, ref src, 0, ref blend, NativeMethods.ULW_ALPHA);
            }
        }

        private bool _disposed;

        protected override void Dispose(bool disposing)
        {
            if (_disposed) { base.Dispose(disposing); return; }
            _disposed = true;
            if (disposing)
            {
                Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
                Sleep();
                _timer.Dispose();
                if (_world != null) _world.Dispose();
                _clearBrush.Dispose();
            }
            ReleaseSurface();
            Marshal.FreeHGlobal(_ptDst);
            Marshal.FreeHGlobal(_ptSrc);
            Marshal.FreeHGlobal(_size);
            Marshal.FreeHGlobal(_blend);
            Marshal.FreeHGlobal(_rc);
            base.Dispose(disposing);
        }
    }
}
