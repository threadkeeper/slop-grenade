// SlopGrenadeOverlay.cs
// Native Windows Desktop Monitor Overlay + System Tray Application for Slop Grenade.
// Renders 60fps per-pixel alpha (UpdateLayeredWindow) animations directly over the
// primary Windows desktop monitor (click-through WS_EX_TRANSPARENT | WS_EX_TOPMOST)
// while the Rust M365 WorkIQ MCP + GitHub GPT Luna daemon runs in the background.

using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace SlopGrenadeDesktop
{
    internal static class NativeWin32
    {
        public const int WS_EX_LAYERED = 0x00080000;
        public const int WS_EX_TRANSPARENT = 0x00000020;
        public const int WS_EX_TOPMOST = 0x00000008;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        public const byte AC_SRC_OVER = 0x00;
        public const byte AC_SRC_ALPHA = 0x01;
        public const int ULW_ALPHA = 0x00000002;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int x;
            public int y;
            public POINT(int x, int y) { this.x = x; this.y = y; }
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SIZE
        {
            public int cx;
            public int cy;
            public SIZE(int cx, int cy) { this.cx = cx; this.cy = cy; }
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool UpdateLayeredWindow(
            IntPtr hwnd,
            IntPtr hdcDst,
            ref POINT pptDst,
            ref SIZE psize,
            IntPtr hdcSrc,
            ref POINT pptSrc,
            uint crKey,
            ref BLENDFUNCTION pblend,
            uint dwFlags);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", ExactSpelling = true)]
        public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool DeleteObject(IntPtr hObject);
    }

    internal enum AnimationTier
    {
        HumanSparkle,
        PeacefulCloud,
        InnocentFruit,
        SlopSplat,
        SlopGrenade
    }

    internal enum MonitorSide
    {
        Left,
        Right
    }

    internal enum GrenadePhase
    {
        Flight,
        Impact,
        SlidingGoop,
        Accumulated,
        Done
    }

    internal sealed class GoopBlob
    {
        public float OffsetX;
        public float OffsetY;
        public float BaseRadius;
        public float SquishFreq;
        public float SquishPhase;
        public float SlideRate;
        public Color PrimaryColor;
        public Color SecondaryColor;
        public Color ShadowColor;
        public float LumpAngleDeg;
    }

    internal sealed class GoopDrip
    {
        public float OffsetX;
        public float OriginY;
        public float CurrentY;
        public float MaxDropDistance;
        public float Radius;
        public float SlideSpeed;
        public float WobbleFreq;
        public float WobblePhase;
        public Color DripColor;
        public Color HighlightColor;
    }

    internal sealed class GoopBubble
    {
        public float OffsetX;
        public float OffsetY;
        public float Radius;
        public float PopTime;
    }

    internal sealed class SparkleParticle
    {
        public float X;
        public float Y;
        public float Vx;
        public float Vy;
        public float Size;
        public float Alpha;
        public float TwinklePhase;
    }

    internal sealed class ActiveAnimation
    {
        public int Id;
        public AnimationTier Tier;
        public MonitorSide Side;
        public bool IsBrownBlue;
        public int Score;
        public string Sender = "";
        public string Subject = "";
        public float Elapsed;
        public float Duration;
        public bool PersistentSlop;

        public float StartX;
        public float StartY;
        public float ImpactX;
        public float ImpactY;
        public float CurrentX;
        public float CurrentY;
        public float RotationRad;

        public GrenadePhase Phase;
        public float SlideDistance;
        public float MaxSlideDistance;
        public float ShakeIntensity;

        public List<GoopBlob> Blobs = new List<GoopBlob>();
        public List<GoopDrip> Drips = new List<GoopDrip>();
        public List<GoopBubble> Bubbles = new List<GoopBubble>();
        public List<SparkleParticle> Sparkles = new List<SparkleParticle>();
        public int FruitIndex;
    }

    internal sealed class SqueegeeWipe
    {
        public MonitorSide Side;
        public float CurrentY;
        public float ViewportHeight;
        public float Speed;
        public bool Done;
    }

    /// <summary>
    /// Topmost, click-through, per-pixel alpha native Windows desktop overlay canvas.
    /// </summary>
    internal sealed class DesktopOverlayForm : Form
    {
        public static readonly string[] FruitNames = new string[]
        {
            "Honeycrisp Apple",
            "Bartlett Pear",
            "Valencia Orange",
            "Amalfi Lemon",
            "Ruby Strawberry",
            "Twin Bing Cherries",
            "Crimson Watermelon",
            "Golden Pineapple",
            "Alphonso Mango",
            "Emerald Kiwi",
            "Red Dragonfruit",
            "Concord Grapes",
            "Velvet Sun Peach",
            "Royal Plum",
            "Ruby Pomegranate",
            "Black Mission Fig",
            "Tropical Papaya",
            "Golden Starfruit",
            "Wild Blueberries",
            "Purple Passionfruit"
        };

        private static readonly Color[][] BrownRedSwatches = new Color[][]
        {
            new Color[] { Color.FromArgb(255, 46, 147), Color.FromArgb(255, 115, 185), Color.FromArgb(158, 12, 82) },
            new Color[] { Color.FromArgb(240, 28, 130), Color.FromArgb(255, 92, 173), Color.FromArgb(143, 8, 71) },
            new Color[] { Color.FromArgb(255, 66, 158), Color.FromArgb(255, 133, 194), Color.FromArgb(179, 18, 93) },
            new Color[] { Color.FromArgb(230, 25, 122), Color.FromArgb(255, 102, 178), Color.FromArgb(130, 6, 64) },
            new Color[] { Color.FromArgb(255, 56, 152), Color.FromArgb(255, 120, 189), Color.FromArgb(153, 13, 77) }
        };

        private static readonly Color[][] BrownBlueSwatches = new Color[][]
        {
            new Color[] { Color.FromArgb(0, 150, 255), Color.FromArgb(102, 204, 255), Color.FromArgb(0, 72, 138) },
            new Color[] { Color.FromArgb(0, 123, 230), Color.FromArgb(56, 182, 255), Color.FromArgb(0, 58, 112) },
            new Color[] { Color.FromArgb(26, 163, 255), Color.FromArgb(112, 204, 255), Color.FromArgb(0, 82, 153) },
            new Color[] { Color.FromArgb(0, 132, 240), Color.FromArgb(77, 189, 255), Color.FromArgb(0, 63, 122) },
            new Color[] { Color.FromArgb(13, 158, 255), Color.FromArgb(102, 199, 255), Color.FromArgb(0, 76, 143) }
        };

        private readonly object _sync = new object();
        private readonly List<ActiveAnimation> _animations = new List<ActiveAnimation>();
        private readonly List<SqueegeeWipe> _wipes = new List<SqueegeeWipe>();
        private readonly Random _rng = new Random();
        private int _nextId = 1;
        private Bitmap _surface;
        private Stopwatch _clock = Stopwatch.StartNew();
        private long _lastMs;

        public event Action<int, int> SlopCountsChanged;

        public DesktopOverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;

            Rectangle screen = Screen.PrimaryScreen.Bounds;
            Bounds = screen;
            _surface = new Bitmap(screen.Width, screen.Height, PixelFormat.Format32bppPArgb);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= NativeWin32.WS_EX_LAYERED
                            | NativeWin32.WS_EX_TRANSPARENT
                            | NativeWin32.WS_EX_TOPMOST
                            | NativeWin32.WS_EX_TOOLWINDOW
                            | NativeWin32.WS_EX_NOACTIVATE;
                return cp;
            }
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        public void GetSlopCounts(out int leftCount, out int rightCount)
        {
            lock (_sync)
            {
                leftCount = 0;
                rightCount = 0;
                foreach (ActiveAnimation a in _animations)
                {
                    if (a.PersistentSlop && a.Phase != GrenadePhase.Done)
                    {
                        if (a.Side == MonitorSide.Left) leftCount++;
                        else rightCount++;
                    }
                }
            }
        }

        public void SpawnAnimation(AnimationTier tier, MonitorSide side, int score, string sender, string subject, int? fruitOverride = null)
        {
            lock (_sync)
            {
                int id = _nextId++;
                int w = Width;
                int h = Height;
                bool isBrownBlue = (side == MonitorSide.Right);
                Color[][] swatches = isBrownBlue ? BrownBlueSwatches : BrownRedSwatches;

                float impactX = side == MonitorSide.Left ? 14f : Math.Max(40f, w - 14f);
                float impactY = (float)(h * (0.06 + _rng.NextDouble() * 0.86));
                float startX = (float)(w * 0.5 + (side == MonitorSide.Left ? 140 : -140));
                float startY = (float)(h * 0.82);

                float inward = side == MonitorSide.Left ? 1f : -1f;
                float initialX = tier == AnimationTier.SlopGrenade
                    ? startX
                    : (tier == AnimationTier.InnocentFruit
                        ? impactX + inward * 64f
                        : (tier == AnimationTier.PeacefulCloud ? impactX + inward * 72f : impactX));

                ActiveAnimation anim = new ActiveAnimation
                {
                    Id = id,
                    Tier = tier,
                    Side = side,
                    IsBrownBlue = isBrownBlue,
                    Score = score,
                    Sender = sender ?? "M365 Colleague",
                    Subject = subject ?? "M365 Message",
                    Elapsed = 0f,
                    Duration = tier == AnimationTier.SlopGrenade ? 6f : (tier == AnimationTier.SlopSplat ? 4.5f : 2.4f),
                    PersistentSlop = true,
                    StartX = startX,
                    StartY = startY,
                    ImpactX = impactX,
                    ImpactY = impactY,
                    CurrentX = initialX,
                    CurrentY = tier == AnimationTier.SlopGrenade ? startY : impactY,
                    Phase = tier == AnimationTier.SlopGrenade ? GrenadePhase.Flight : GrenadePhase.SlidingGoop,
                    MaxSlideDistance = tier == AnimationTier.SlopGrenade
                        ? (float)(42 + _rng.NextDouble() * 54)
                        : (float)(24 + _rng.NextDouble() * 32),
                    FruitIndex = fruitOverride ?? _rng.Next(FruitNames.Length)
                };

                if (tier == AnimationTier.SlopGrenade || tier == AnimationTier.SlopSplat)
                {
                    int blobCount = tier == AnimationTier.SlopGrenade ? 10 : 6;
                    int dripCount = tier == AnimationTier.SlopGrenade ? 6 : 4;
                    float spreadX = tier == AnimationTier.SlopGrenade ? 24f : 16f;
                    float spreadY = tier == AnimationTier.SlopGrenade ? 44f : 28f;

                    for (int i = 0; i < blobCount; i++)
                    {
                        Color[] sw = swatches[_rng.Next(swatches.Length)];
                        anim.Blobs.Add(new GoopBlob
                        {
                            OffsetX = inward * (float)(_rng.NextDouble() * spreadX),
                            OffsetY = (float)((_rng.NextDouble() - 0.45) * spreadY),
                            BaseRadius = (float)((tier == AnimationTier.SlopGrenade ? 6.5 : 5.0) + _rng.NextDouble() * (tier == AnimationTier.SlopGrenade ? 9.5 : 6.5)),
                            SquishFreq = (float)(3.5 + _rng.NextDouble() * 4.0),
                            SquishPhase = (float)(_rng.NextDouble() * Math.PI * 2),
                            SlideRate = (float)((tier == AnimationTier.SlopGrenade ? 10 : 7) + _rng.NextDouble() * 12),
                            PrimaryColor = sw[0],
                            SecondaryColor = sw[1],
                            ShadowColor = sw[2],
                            LumpAngleDeg = (float)((_rng.NextDouble() - 0.5) * 40.0)
                        });
                    }

                    for (int i = 0; i < dripCount; i++)
                    {
                        Color[] sw = swatches[_rng.Next(swatches.Length)];
                        float origOff = (float)((_rng.NextDouble() - 0.3) * 32.0);
                        anim.Drips.Add(new GoopDrip
                        {
                            OffsetX = inward * (float)(2 + _rng.NextDouble() * (spreadX * 0.85)),
                            OriginY = impactY + origOff,
                            CurrentY = impactY + origOff,
                            MaxDropDistance = (float)((tier == AnimationTier.SlopGrenade ? 36 : 22) + _rng.NextDouble() * 68),
                            Radius = (float)((tier == AnimationTier.SlopGrenade ? 3.5 : 2.8) + _rng.NextDouble() * 4.5),
                            SlideSpeed = (float)(16 + _rng.NextDouble() * 28),
                            WobbleFreq = (float)(2.5 + _rng.NextDouble() * 3.5),
                            WobblePhase = (float)(_rng.NextDouble() * Math.PI * 2),
                            DripColor = (i % 2 == 0) ? sw[0] : sw[1],
                            HighlightColor = Color.FromArgb(180, 255, 255, 255)
                        });
                    }

                    for (int i = 0; i < 6; i++)
                    {
                        anim.Bubbles.Add(new GoopBubble
                        {
                            OffsetX = inward * (float)(3 + _rng.NextDouble() * 20),
                            OffsetY = (float)((_rng.NextDouble() - 0.4) * 36),
                            Radius = (float)(1.8 + _rng.NextDouble() * 3.0),
                            PopTime = (float)(2.0 + _rng.NextDouble() * 6.5)
                        });
                    }
                }
                else if (tier == AnimationTier.InnocentFruit)
                {
                    for (int i = 0; i < 6; i++)
                    {
                        anim.Sparkles.Add(new SparkleParticle
                        {
                            X = initialX,
                            Y = impactY,
                            Vx = inward * (float)(10 + _rng.NextDouble() * 22),
                            Vy = (float)(-22 - _rng.NextDouble() * 22),
                            Size = (float)(1.8 + _rng.NextDouble() * 2.0),
                            Alpha = 0.85f,
                            TwinklePhase = (float)(_rng.NextDouble() * Math.PI * 2)
                        });
                    }
                }
                else if (tier == AnimationTier.HumanSparkle)
                {
                    for (int i = 0; i < 10; i++)
                    {
                        anim.Sparkles.Add(new SparkleParticle
                        {
                            X = impactX + inward * (float)(4 + _rng.NextDouble() * 18),
                            Y = impactY + (float)((_rng.NextDouble() - 0.5) * 26),
                            Vx = inward * (float)(2 + _rng.NextDouble() * 5) + (float)((_rng.NextDouble() - 0.5) * 4),
                            Vy = (float)(-8 - _rng.NextDouble() * 12),
                            Size = (float)(1.5 + _rng.NextDouble() * 1.8),
                            Alpha = (float)(0.35 + _rng.NextDouble() * 0.3),
                            TwinklePhase = (float)(_rng.NextDouble() * Math.PI * 2)
                        });
                    }
                }

                _animations.Add(anim);
            }
            NotifySlopCounts();
        }

        public void StartSqueegeeWipe(MonitorSide side)
        {
            lock (_sync)
            {
                _wipes.Add(new SqueegeeWipe
                {
                    Side = side,
                    CurrentY = -40f,
                    ViewportHeight = Height,
                    Speed = Math.Max(720f, Height * 0.95f),
                    Done = false
                });
            }
        }

        private void NotifySlopCounts()
        {
            if (SlopCountsChanged != null)
            {
                int l, r;
                GetSlopCounts(out l, out r);
                SlopCountsChanged(l, r);
            }
        }

        public void StepAndRender()
        {
            long nowMs = _clock.ElapsedMilliseconds;
            float dt = (nowMs - _lastMs) / 1000f;
            _lastMs = nowMs;
            if (dt <= 0f || dt > 0.25f) dt = 0.016f;

            bool countsChanged = false;
            lock (_sync)
            {
                for (int i = _animations.Count - 1; i >= 0; i--)
                {
                    StepAnimation(_animations[i], dt);
                    if (_animations[i].Phase == GrenadePhase.Done)
                    {
                        _animations.RemoveAt(i);
                    }
                }

                for (int w = _wipes.Count - 1; w >= 0; w--)
                {
                    SqueegeeWipe wipe = _wipes[w];
                    wipe.CurrentY += wipe.Speed * dt;
                    if (wipe.CurrentY >= wipe.ViewportHeight + 80f)
                    {
                        wipe.Done = true;
                    }

                    for (int i = _animations.Count - 1; i >= 0; i--)
                    {
                        ActiveAnimation a = _animations[i];
                        if (a.Side == wipe.Side && a.PersistentSlop && a.CurrentY <= wipe.CurrentY + 24f)
                        {
                            _animations.RemoveAt(i);
                            countsChanged = true;
                        }
                    }

                    if (wipe.Done)
                    {
                        _wipes.RemoveAt(w);
                    }
                }

                using (Graphics g = Graphics.FromImage(_surface))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.CompositingQuality = CompositingQuality.HighQuality;

                    foreach (ActiveAnimation anim in _animations)
                    {
                        DrawAnimation(g, anim);
                    }
                    foreach (SqueegeeWipe wipe in _wipes)
                    {
                        DrawSqueegeeWipe(g, Width, wipe);
                    }
                }
            }

            if (countsChanged)
            {
                NotifySlopCounts();
            }

            PresentLayeredBitmap();
        }

        private static void StepAnimation(ActiveAnimation anim, float dt)
        {
            anim.Elapsed += dt;
            if (!anim.PersistentSlop && anim.Elapsed >= anim.Duration)
            {
                anim.Phase = GrenadePhase.Done;
                return;
            }

            if (anim.Tier == AnimationTier.SlopGrenade)
            {
                const float flightDuration = 0.72f;
                const float impactDuration = 0.28f;
                if (anim.Elapsed < flightDuration)
                {
                    anim.Phase = GrenadePhase.Flight;
                    float t = anim.Elapsed / flightDuration;
                    anim.CurrentX = anim.StartX + (anim.ImpactX - anim.StartX) * t;
                    float linearY = anim.StartY + (anim.ImpactY - anim.StartY) * t;
                    float arcLift = -210f * 4f * t * (1f - t);
                    anim.CurrentY = linearY + arcLift;
                    anim.RotationRad = t * (float)Math.PI * 5.2f * (anim.Side == MonitorSide.Left ? -1f : 1f);
                    anim.ShakeIntensity = 0f;
                }
                else if (anim.Elapsed < flightDuration + impactDuration)
                {
                    anim.Phase = GrenadePhase.Impact;
                    anim.CurrentX = anim.ImpactX;
                    anim.CurrentY = anim.ImpactY;
                    float it = (anim.Elapsed - flightDuration) / impactDuration;
                    anim.ShakeIntensity = (1f - it) * 15f;
                }
                else
                {
                    anim.CurrentX = anim.ImpactX;
                    anim.ShakeIntensity = 0f;
                    if (anim.SlideDistance < anim.MaxSlideDistance && anim.Elapsed < anim.Duration)
                    {
                        anim.Phase = GrenadePhase.SlidingGoop;
                        float damp = Math.Max(0.22f, 1f - anim.SlideDistance / (anim.MaxSlideDistance * 1.15f));
                        anim.SlideDistance += 42f * damp * dt;
                    }
                    else
                    {
                        anim.Phase = GrenadePhase.Accumulated;
                        anim.SlideDistance += 0.7f * dt;
                    }
                    anim.CurrentY = anim.ImpactY + anim.SlideDistance;

                    foreach (GoopDrip d in anim.Drips)
                    {
                        float drop = d.CurrentY - d.OriginY;
                        if (drop < d.MaxDropDistance)
                        {
                            float df = Math.Max(0.15f, 1f - drop / (d.MaxDropDistance * 1.1f));
                            d.CurrentY += d.SlideSpeed * df * dt;
                        }
                        else
                        {
                            d.CurrentY += 0.45f * dt;
                        }
                    }
                }
            }
            else if (anim.Tier == AnimationTier.SlopSplat)
            {
                if (anim.SlideDistance < anim.MaxSlideDistance && anim.Elapsed < anim.Duration)
                {
                    anim.Phase = GrenadePhase.SlidingGoop;
                    anim.SlideDistance += 18f * dt;
                }
                else
                {
                    anim.Phase = GrenadePhase.Accumulated;
                    anim.SlideDistance += 0.4f * dt;
                }
                anim.CurrentY = anim.ImpactY + anim.SlideDistance;
                foreach (GoopDrip d in anim.Drips)
                {
                    if (d.CurrentY - d.OriginY < d.MaxDropDistance)
                    {
                        d.CurrentY += d.SlideSpeed * dt;
                    }
                }
            }
            else if (anim.Tier == AnimationTier.InnocentFruit)
            {
                float inward = anim.Side == MonitorSide.Left ? 1f : -1f;
                if (anim.Elapsed < anim.Duration)
                {
                    anim.Phase = GrenadePhase.SlidingGoop;
                    float t = anim.Elapsed / anim.Duration;
                    float dist = 54f * (1f - t * 0.72f) + (float)Math.Sin(anim.Elapsed * 5.0) * 8f * (1f - t);
                    anim.CurrentX = anim.ImpactX + inward * dist;
                    anim.CurrentY = anim.ImpactY - (float)Math.Abs(Math.Sin(anim.Elapsed * 4.2)) * 20f * (1f - t);
                    foreach (SparkleParticle sp in anim.Sparkles)
                    {
                        sp.X += sp.Vx * dt;
                        sp.Y += sp.Vy * dt;
                        sp.Vy += 65f * dt;
                    }
                }
                else
                {
                    anim.Phase = GrenadePhase.Accumulated;
                    anim.CurrentX = anim.ImpactX + inward * 14f;
                }
            }
            else if (anim.Tier == AnimationTier.PeacefulCloud)
            {
                float inward = anim.Side == MonitorSide.Left ? 1f : -1f;
                if (anim.Elapsed < anim.Duration)
                {
                    anim.Phase = GrenadePhase.SlidingGoop;
                    float t = anim.Elapsed / anim.Duration;
                    anim.CurrentX = anim.ImpactX + inward * (64f * (1f - t * 0.75f));
                    anim.CurrentY = anim.ImpactY + (float)Math.Sin(anim.Elapsed * 2.2) * 5f * (1f - t);
                }
                else
                {
                    anim.Phase = GrenadePhase.Accumulated;
                    anim.CurrentX = anim.ImpactX + inward * 16f;
                }
            }
            else
            {
                if (anim.Elapsed < anim.Duration)
                {
                    anim.Phase = GrenadePhase.SlidingGoop;
                    foreach (SparkleParticle sp in anim.Sparkles)
                    {
                        sp.X += sp.Vx * dt * 0.4f + (float)Math.Sin(anim.Elapsed * 3.0 + sp.TwinklePhase) * 0.2f;
                        sp.Y += sp.Vy * dt * 0.4f;
                    }
                }
                else
                {
                    anim.Phase = GrenadePhase.Accumulated;
                }
            }
        }

        private void DrawAnimation(Graphics g, ActiveAnimation anim)
        {
            float progress = anim.Elapsed / anim.Duration;
            float fadeOut = anim.PersistentSlop
                ? 1f
                : (progress > 0.78f ? Math.Max(0f, 1f - (progress - 0.78f) / 0.22f) : 1f);

            GraphicsState state = g.Save();
            if (anim.ShakeIntensity > 0f)
            {
                float dx = (float)((_rng.NextDouble() - 0.5) * anim.ShakeIntensity);
                float dy = (float)((_rng.NextDouble() - 0.5) * anim.ShakeIntensity);
                g.TranslateTransform(dx, dy);
            }

            if (anim.Tier == AnimationTier.SlopGrenade)
            {
                DrawSlopGrenade(g, anim);
            }
            else if (anim.Tier == AnimationTier.SlopSplat)
            {
                DrawPoopSlopSplat(g, anim, false);
            }
            else if (anim.Tier == AnimationTier.InnocentFruit)
            {
                DrawArtisticFruit(g, anim, fadeOut);
            }
            else if (anim.Tier == AnimationTier.PeacefulCloud)
            {
                DrawPeacefulCloud(g, anim, fadeOut);
            }
            else
            {
                DrawHumanSparkles(g, anim, fadeOut);
            }

            g.Restore(state);
        }

        private void DrawSlopGrenade(Graphics g, ActiveAnimation anim)
        {
            if (anim.Phase == GrenadePhase.Flight)
            {
                // Ballistic smoke arc
                using (Pen trailPen = new Pen(anim.IsBrownBlue ? Color.FromArgb(145, 110, 142, 178) : Color.FromArgb(145, 168, 92, 74), 3.5f))
                {
                    trailPen.DashStyle = DashStyle.Dash;
                    PointF p0 = new PointF(anim.StartX, anim.StartY);
                    PointF p1 = new PointF((anim.StartX + anim.ImpactX) * 0.5f, Math.Min(anim.StartY, anim.ImpactY) - 160f);
                    PointF p2 = new PointF(anim.CurrentX, anim.CurrentY);
                    g.DrawBezier(trailPen, p0, p1, p1, p2);
                }

                // Compact Dull Metallic Blue Mk2 Pineapple Hand Grenade
                GraphicsState gs = g.Save();
                g.TranslateTransform(anim.CurrentX, anim.CurrentY);
                g.RotateTransform(anim.RotationRad * 180f / (float)Math.PI);
                g.ScaleTransform(0.68f, 0.68f);

                // Cast gunmetal-blue ovoid body
                using (GraphicsPath bodyPath = new GraphicsPath())
                {
                    bodyPath.AddEllipse(-23f, -25f, 46f, 60f);
                    using (PathGradientBrush pgb = new PathGradientBrush(bodyPath))
                    {
                        pgb.CenterPoint = new PointF(-8f, -6f);
                        pgb.CenterColor = Color.FromArgb(255, 118, 144, 172); // Brushed dull steel-blue highlight
                        pgb.SurroundColors = new Color[] { Color.FromArgb(255, 34, 49, 64) }; // Deep gunmetal slate-blue
                        g.FillPath(pgb, bodyPath);
                    }
                    using (Pen outline = new Pen(Color.FromArgb(255, 20, 29, 39), 2.4f))
                    {
                        g.DrawPath(outline, bodyPath);
                    }
                }

                // 3D Raised Waffle Fragmentation Segments (4 rows x 3 columns)
                float[] rowYs = new float[] { -14f, -4f, 6f, 16f };
                float[] colXs = new float[] { -10f, 0f, 10f };
                using (SolidBrush trenchBrush = new SolidBrush(Color.FromArgb(255, 22, 32, 43)))
                using (Pen glintPen = new Pen(Color.FromArgb(140, 190, 212, 235), 1.0f))
                {
                    for (int r = 0; r < rowYs.Length; r++)
                    {
                        float ry = rowYs[r];
                        float scale = (r == 0 || r == 3) ? 0.82f : 1.0f;
                        for (int c = 0; c < colXs.Length; c++)
                        {
                            float cx = colXs[c] * scale;
                            float bw = 7.6f * scale;
                            float bh = 7.8f;
                            RectangleF segRect = new RectangleF(cx - bw * 0.5f, ry - bh * 0.5f, bw, bh);
                            g.FillRectangle(trenchBrush, cx - bw * 0.5f - 1f, ry - bh * 0.5f - 1f, bw + 2f, bh + 2f);
                            using (LinearGradientBrush segBrush = new LinearGradientBrush(segRect, Color.FromArgb(255, 120, 147, 176), Color.FromArgb(255, 38, 53, 68), 45f))
                            {
                                g.FillRectangle(segBrush, segRect);
                            }
                            g.DrawLine(glintPen, segRect.Left + 1f, segRect.Top + 1f, segRect.Right - 1f, segRect.Top + 1f);
                        }
                    }
                }

                // Threaded zinc/steel neck collar
                RectangleF neckRect = new RectangleF(-8.5f, -32f, 17f, 9f);
                using (LinearGradientBrush neckBrush = new LinearGradientBrush(neckRect, Color.FromArgb(255, 148, 163, 184), Color.FromArgb(255, 51, 65, 85), 0f))
                using (Pen darkPen = new Pen(Color.FromArgb(255, 30, 41, 59), 1.8f))
                {
                    g.FillRectangle(neckBrush, neckRect);
                    g.DrawRectangle(darkPen, -8.5f, -32f, 17f, 9f);

                    // Brass striker head
                    using (SolidBrush brassBrush = new SolidBrush(Color.FromArgb(255, 138, 121, 78)))
                    {
                        g.FillRectangle(brassBrush, -10f, -38f, 20f, 6.5f);
                        g.DrawRectangle(darkPen, -10f, -38f, 20f, 6.5f);
                    }

                    // Safety spoon lever kicking outward
                    PointF[] spoon = new PointF[]
                    {
                        new PointF(6f, -35f),
                        new PointF(16f, -32f),
                        new PointF(22f, 2f),
                        new PointF(16f, 4f),
                        new PointF(11f, -28f)
                    };
                    using (SolidBrush spoonBrush = new SolidBrush(Color.FromArgb(255, 71, 85, 105)))
                    {
                        g.FillPolygon(spoonBrush, spoon);
                        g.DrawPolygon(darkPen, spoon);
                    }
                }

                // Pulled safety pin ring
                using (Pen ringPen = new Pen(Color.FromArgb(255, 203, 213, 225), 2.2f))
                {
                    g.DrawEllipse(ringPen, -21f, -39f, 13f, 13f);
                }

                // Fuse ignition spark
                float sr = 7f + (float)Math.Sin(anim.Elapsed * 45.0) * 2.5f;
                using (SolidBrush outerSpark = new SolidBrush(Color.FromArgb(190, 251, 191, 36)))
                using (SolidBrush innerSpark = new SolidBrush(Color.FromArgb(255, 255, 255, 255)))
                {
                    g.FillEllipse(outerSpark, -sr, -41f - sr, sr * 2f, sr * 2f);
                    g.FillEllipse(innerSpark, -sr * 0.45f, -41f - sr * 0.45f, sr * 0.9f, sr * 0.9f);
                }

                g.Restore(gs);
                return;
            }

            if (anim.Phase == GrenadePhase.Impact)
            {
                float ie = anim.Elapsed - 0.72f;
                float rad = 24f + ie * 320f;
                int alpha = Math.Max(0, Math.Min(240, (int)((0.9f - ie * 2.5f) * 255f)));
                Color ringCol = anim.IsBrownBlue ? Color.FromArgb(alpha, 92, 126, 162) : Color.FromArgb(alpha, 158, 72, 52);
                using (Pen ringPen = new Pen(ringCol, 8f))
                {
                    g.DrawEllipse(ringPen, anim.ImpactX - rad, anim.ImpactY - rad, rad * 2f, rad * 2f);
                }
            }

            DrawPoopSlopSplat(g, anim, true);
        }

        private void DrawPoopSlopSplat(Graphics g, ActiveAnimation anim, bool isGrenade)
        {
            float crustW = isGrenade ? 22f : 15f;
            float crustX = anim.Side == MonitorSide.Left ? 0f : (Width - crustW);
            RectangleF crustRect = new RectangleF(crustX, anim.ImpactY - 18f, crustW, anim.SlideDistance + 44f);

            Color cTop = anim.IsBrownBlue ? Color.FromArgb(225, 0, 150, 255) : Color.FromArgb(225, 255, 46, 147);
            Color cBot = anim.IsBrownBlue ? Color.FromArgb(195, 0, 98, 204) : Color.FromArgb(195, 214, 20, 114);
            using (LinearGradientBrush smearBrush = new LinearGradientBrush(crustRect, cTop, cBot, 90f))
            {
                g.FillRectangle(smearBrush, crustRect);
            }

            // Viscous hanging poop-sludge tendrils dripping down the side of the screen
            foreach (GoopDrip drip in anim.Drips)
            {
                float wobbleAmp = anim.Phase == GrenadePhase.Accumulated ? 0.8f : 3.2f;
                float wx = anim.ImpactX + drip.OffsetX + (float)Math.Sin(anim.Elapsed * drip.WobbleFreq + drip.WobblePhase) * wobbleAmp;
                float topY = drip.OriginY + anim.SlideDistance * 0.42f;
                float botY = Math.Max(topY + 12f, drip.CurrentY);

                Color shadowCol = anim.IsBrownBlue ? Color.FromArgb(220, 20, 24, 30) : Color.FromArgb(220, 36, 10, 6);
                using (Pen shadowPen = new Pen(shadowCol, Math.Max(6f, drip.Radius * 1.18f)))
                using (Pen tendrilPen = new Pen(drip.DripColor, Math.Max(4.5f, drip.Radius * 0.96f)))
                {
                    shadowPen.StartCap = LineCap.Round;
                    shadowPen.EndCap = LineCap.Round;
                    tendrilPen.StartCap = LineCap.Round;
                    tendrilPen.EndCap = LineCap.Round;
                    g.DrawLine(shadowPen, wx, topY, wx, botY);
                    g.DrawLine(tendrilPen, wx, topY, wx, botY);
                }

                using (SolidBrush headBrush = new SolidBrush(drip.DripColor))
                using (SolidBrush hiBrush = new SolidBrush(drip.HighlightColor))
                using (Pen borderPen = new Pen(shadowCol, 1.4f))
                {
                    float rx = drip.Radius * 0.98f;
                    float ry = drip.Radius * 1.35f;
                    g.FillEllipse(headBrush, wx - rx, botY - ry, rx * 2f, ry * 2f);
                    g.DrawEllipse(borderPen, wx - rx, botY - ry, rx * 2f, ry * 2f);
                    g.FillEllipse(hiBrush, wx - rx * 0.55f, botY - ry * 0.55f, rx * 0.5f, ry * 0.7f);
                }
            }

            // Lumpy, coiled poop-like sludge mounds caked onto the side of the monitor
            foreach (GoopBlob blob in anim.Blobs)
            {
                float squishAmp = anim.Phase == GrenadePhase.Accumulated ? 0.04f : 0.18f;
                float squish = (float)Math.Sin(anim.Elapsed * blob.SquishFreq + blob.SquishPhase);
                float rx = blob.BaseRadius * (1.06f + squish * squishAmp);
                float ry = blob.BaseRadius * (1.22f - squish * squishAmp);
                float bx = anim.ImpactX + blob.OffsetX;
                float slideOff = Math.Min(anim.SlideDistance * 0.92f, Math.Max(0f, (anim.Elapsed - 0.5f) * blob.SlideRate));
                float by = anim.ImpactY + blob.OffsetY + slideOff;

                GraphicsState bs = g.Save();
                g.TranslateTransform(bx, by);
                g.RotateTransform(blob.LumpAngleDeg);

                using (GraphicsPath mp = new GraphicsPath())
                {
                    mp.AddEllipse(-rx, -ry, rx * 2f, ry * 2f);
                    using (PathGradientBrush pgb = new PathGradientBrush(mp))
                    {
                        pgb.CenterPoint = new PointF(-rx * 0.25f, -ry * 0.25f);
                        pgb.CenterColor = blob.SecondaryColor;
                        pgb.SurroundColors = new Color[] { blob.PrimaryColor };
                        g.FillPath(pgb, mp);
                    }
                    using (Pen outlinePen = new Pen(blob.ShadowColor, 1.8f))
                    {
                        g.DrawPath(outlinePen, mp);
                    }
                }

                // Coiled poop-ridge crease
                using (Pen creasePen = new Pen(blob.ShadowColor, 2.2f))
                {
                    g.DrawArc(creasePen, -rx * 0.68f, -ry * 0.45f, rx * 1.36f, ry * 1.1f, 25f, 130f);
                }

                // Glossy white vinyl plastic highlight
                Color sheen = Color.FromArgb(155, 255, 255, 255);
                using (SolidBrush sheenBrush = new SolidBrush(sheen))
                {
                    g.FillEllipse(sheenBrush, -rx * 0.55f, -ry * 0.52f, rx * 0.58f, ry * 0.34f);
                }

                g.Restore(bs);
            }
        }

        private static void DrawSqueegeeWipe(Graphics g, int viewportWidth, SqueegeeWipe wipe)
        {
            bool isLeft = wipe.Side == MonitorSide.Left;
            float bladeW = 145f;
            float bx = isLeft ? 0f : (viewportWidth - bladeW);
            float y = wipe.CurrentY;

            // Clean sparkling glass trail above blade
            RectangleF trailRect = new RectangleF(bx, Math.Max(0f, y - 160f), bladeW, 160f);
            if (trailRect.Height > 2f)
            {
                using (LinearGradientBrush trailBrush = new LinearGradientBrush(trailRect, Color.FromArgb(0, 56, 189, 248), Color.FromArgb(75, 186, 230, 253), 90f))
                {
                    g.FillRectangle(trailBrush, trailRect);
                }
            }

            // Silicone rubber blade
            using (SolidBrush bladeBrush = new SolidBrush(Color.FromArgb(255, 2, 132, 199)))
            using (Pen lipPen = new Pen(Color.FromArgb(255, 224, 242, 254), 2f))
            using (SolidBrush steelBrush = new SolidBrush(Color.FromArgb(255, 148, 163, 184)))
            using (SolidBrush handleBrush = new SolidBrush(Color.FromArgb(255, 51, 65, 85)))
            using (SolidBrush foamBrush = new SolidBrush(Color.FromArgb(230, 240, 249, 255)))
            {
                g.FillRectangle(bladeBrush, bx, y - 6f, bladeW, 12f);
                g.DrawRectangle(lipPen, bx, y - 6f, bladeW, 12f);
                g.FillRectangle(steelBrush, bx + (isLeft ? 0f : 18f), y - 14f, bladeW - 18f, 8f);

                float hx = isLeft ? bladeW * 0.55f : (viewportWidth - bladeW * 0.55f);
                g.FillRectangle(handleBrush, hx - 9f, y - 54f, 18f, 42f);
                g.DrawRectangle(lipPen, hx - 9f, y - 54f, 18f, 42f);

                for (int i = 0; i < 8; i++)
                {
                    float fx = bx + 10f + i * 17f;
                    float fy = y + 6f + (float)Math.Sin(y * 0.08 + i) * 3f;
                    float fr = 3.5f + (i % 3);
                    g.FillEllipse(foamBrush, fx - fr, fy - fr, fr * 2f, fr * 2f);
                }
            }
        }

        private static void DrawArtisticFruit(Graphics g, ActiveAnimation anim, float fadeOut)
        {
            int alpha = Math.Max(0, Math.Min(255, (int)(fadeOut * 255f)));
            if (alpha <= 4) return;

            int idx = Math.Abs(anim.FruitIndex) % FruitNames.Length;
            string fruitName = FruitNames[idx];

            Color primary, secondary, accent;
            GetFruitColors(idx, out primary, out secondary, out accent);

            // Juice droplets
            using (SolidBrush dropBrush = new SolidBrush(Color.FromArgb(alpha, primary)))
            {
                foreach (SparkleParticle sp in anim.Sparkles)
                {
                    g.FillEllipse(dropBrush, sp.X - sp.Size, sp.Y - sp.Size * 1.2f, sp.Size * 2f, sp.Size * 2.4f);
                }
            }

            GraphicsState fs = g.Save();
            g.TranslateTransform(anim.CurrentX, anim.CurrentY);
            float squish = anim.Phase == GrenadePhase.Accumulated ? 1f : (1f + (float)Math.Sin(anim.Elapsed * 8.0) * 0.06f);
            g.ScaleTransform(squish * 0.56f, (2f - squish) * 0.56f);

            // Botanical fruit body with multi-stop shading
            using (GraphicsPath fp = new GraphicsPath())
            {
                if (idx == 1 || idx == 8 || idx == 15) // Pear, Mango, Fig teardrop
                {
                    fp.AddEllipse(-18f, -12f, 36f, 38f);
                    fp.AddEllipse(-12f, -24f, 24f, 24f);
                }
                else if (idx == 3) // Amalfi Lemon
                {
                    fp.AddEllipse(-25f, -17f, 50f, 34f);
                }
                else
                {
                    fp.AddEllipse(-22f, -22f, 44f, 44f);
                }

                using (PathGradientBrush pgb = new PathGradientBrush(fp))
                {
                    pgb.CenterPoint = new PointF(-7f, -7f);
                    pgb.CenterColor = Color.FromArgb(alpha, secondary);
                    pgb.SurroundColors = new Color[] { Color.FromArgb(alpha, primary) };
                    g.FillPath(pgb, fp);
                }
            }

            // Characteristic seeds/details (Strawberry achenes, Kiwi emerald core, Watermelon seeds, Pineapple cross-hatch)
            if (idx == 4 || idx == 6 || idx == 9 || idx == 16)
            {
                using (SolidBrush seedBrush = new SolidBrush(Color.FromArgb(alpha, accent)))
                {
                    for (int i = 0; i < 8; i++)
                    {
                        double a = i * Math.PI * 0.25;
                        float sx = (float)Math.Cos(a) * 9f;
                        float sy = (float)Math.Sin(a) * 9f;
                        g.FillEllipse(seedBrush, sx - 1.5f, sy - 2f, 3f, 4f);
                    }
                }
            }

            // Woody stem & veined botanical leaf
            using (Pen stemPen = new Pen(Color.FromArgb(alpha, 120, 53, 15), 3f))
            using (SolidBrush leafBrush = new SolidBrush(Color.FromArgb(alpha, 34, 197, 94)))
            using (SolidBrush sheenBrush = new SolidBrush(Color.FromArgb(Math.Min(255, alpha * 2 / 3), 255, 255, 255)))
            {
                g.DrawLine(stemPen, 0f, -20f, 4f, -31f);
                g.FillEllipse(leafBrush, 2f, -30f, 16f, 8f);
                g.FillEllipse(sheenBrush, -12f, -12f, 10f, 10f);
            }

            g.Restore(fs);
        }

        private static void GetFruitColors(int idx, out Color primary, out Color secondary, out Color accent)
        {
            switch (idx % 20)
            {
                case 0: primary = Color.FromArgb(185, 28, 28); secondary = Color.FromArgb(253, 224, 71); accent = Color.White; break;
                case 1: primary = Color.FromArgb(101, 163, 13); secondary = Color.FromArgb(254, 240, 138); accent = Color.White; break;
                case 2: primary = Color.FromArgb(234, 88, 12); secondary = Color.FromArgb(253, 224, 71); accent = Color.White; break;
                case 3: primary = Color.FromArgb(202, 138, 4); secondary = Color.FromArgb(254, 249, 195); accent = Color.White; break;
                case 4: primary = Color.FromArgb(225, 29, 72); secondary = Color.FromArgb(253, 164, 175); accent = Color.FromArgb(253, 230, 138); break;
                case 5: primary = Color.FromArgb(159, 18, 57); secondary = Color.FromArgb(244, 63, 94); accent = Color.White; break;
                case 6: primary = Color.FromArgb(190, 18, 60); secondary = Color.FromArgb(251, 113, 133); accent = Color.FromArgb(30, 41, 59); break;
                case 7: primary = Color.FromArgb(202, 138, 4); secondary = Color.FromArgb(254, 240, 138); accent = Color.FromArgb(21, 128, 61); break;
                case 8: primary = Color.FromArgb(249, 115, 22); secondary = Color.FromArgb(250, 204, 21); accent = Color.FromArgb(132, 204, 22); break;
                case 9: primary = Color.FromArgb(101, 163, 13); secondary = Color.FromArgb(236, 252, 203); accent = Color.FromArgb(30, 41, 59); break;
                case 10: primary = Color.FromArgb(225, 29, 72); secondary = Color.FromArgb(251, 113, 133); accent = Color.FromArgb(132, 204, 22); break;
                case 11: primary = Color.FromArgb(107, 33, 168); secondary = Color.FromArgb(192, 132, 252); accent = Color.White; break;
                case 12: primary = Color.FromArgb(225, 29, 72); secondary = Color.FromArgb(254, 240, 138); accent = Color.White; break;
                case 13: primary = Color.FromArgb(126, 34, 206); secondary = Color.FromArgb(233, 213, 255); accent = Color.White; break;
                case 14: primary = Color.FromArgb(185, 28, 28); secondary = Color.FromArgb(251, 113, 133); accent = Color.White; break;
                case 15: primary = Color.FromArgb(88, 28, 135); secondary = Color.FromArgb(168, 85, 247); accent = Color.White; break;
                case 16: primary = Color.FromArgb(249, 115, 22); secondary = Color.FromArgb(251, 113, 133); accent = Color.FromArgb(28, 25, 23); break;
                case 17: primary = Color.FromArgb(234, 179, 8); secondary = Color.FromArgb(254, 249, 195); accent = Color.FromArgb(101, 163, 13); break;
                case 18: primary = Color.FromArgb(29, 78, 216); secondary = Color.FromArgb(147, 197, 253); accent = Color.White; break;
                default: primary = Color.FromArgb(88, 28, 135); secondary = Color.FromArgb(250, 204, 21); accent = Color.FromArgb(28, 25, 23); break;
            }
        }

        private static void DrawPeacefulCloud(Graphics g, ActiveAnimation anim, float fadeOut)
        {
            int alpha = Math.Max(0, Math.Min(220, (int)(fadeOut * 215f)));
            if (alpha <= 4) return;
            using (SolidBrush cloudBrush = new SolidBrush(Color.FromArgb(alpha, 214, 240, 255)))
            {
                float x = anim.CurrentX;
                float y = anim.CurrentY;
                g.FillEllipse(cloudBrush, x - 18f, y - 5f, 16f, 16f);
                g.FillEllipse(cloudBrush, x - 9f, y - 11f, 20f, 20f);
                g.FillEllipse(cloudBrush, x + 3f, y - 8f, 17f, 17f);
                g.FillEllipse(cloudBrush, x + 11f, y - 3f, 13f, 13f);
            }
        }

        private static void DrawHumanSparkles(Graphics g, ActiveAnimation anim, float fadeOut)
        {
            foreach (SparkleParticle sp in anim.Sparkles)
            {
                float twinkle = 0.65f + 0.35f * (float)Math.Sin(anim.Elapsed * 6.0 + sp.TwinklePhase);
                int alpha = Math.Max(0, Math.Min(255, (int)(sp.Alpha * twinkle * fadeOut * 255f)));
                if (alpha <= 4) continue;
                using (SolidBrush sb = new SolidBrush(Color.FromArgb(alpha, 253, 230, 138)))
                {
                    float s = sp.Size;
                    PointF[] star = new PointF[]
                    {
                        new PointF(sp.X, sp.Y - s * 2.2f),
                        new PointF(sp.X + s * 0.6f, sp.Y - s * 0.6f),
                        new PointF(sp.X + s * 2.2f, sp.Y),
                        new PointF(sp.X + s * 0.6f, sp.Y + s * 0.6f),
                        new PointF(sp.X, sp.Y + s * 2.2f),
                        new PointF(sp.X - s * 0.6f, sp.Y + s * 0.6f),
                        new PointF(sp.X - s * 2.2f, sp.Y),
                        new PointF(sp.X - s * 0.6f, sp.Y - s * 0.6f)
                    };
                    g.FillPolygon(sb, star);
                }
            }
        }

        private void PresentLayeredBitmap()
        {
            if (!IsHandleCreated || IsDisposed) return;

            IntPtr screenDc = NativeWin32.GetDC(IntPtr.Zero);
            IntPtr memDc = NativeWin32.CreateCompatibleDC(screenDc);
            IntPtr hBitmap = IntPtr.Zero;
            IntPtr oldBitmap = IntPtr.Zero;

            try
            {
                hBitmap = _surface.GetHbitmap(Color.FromArgb(0));
                oldBitmap = NativeWin32.SelectObject(memDc, hBitmap);

                NativeWin32.SIZE size = new NativeWin32.SIZE(Width, Height);
                NativeWin32.POINT pointSource = new NativeWin32.POINT(0, 0);
                NativeWin32.POINT topPos = new NativeWin32.POINT(Left, Top);
                NativeWin32.BLENDFUNCTION blend = new NativeWin32.BLENDFUNCTION
                {
                    BlendOp = NativeWin32.AC_SRC_OVER,
                    BlendFlags = 0,
                    SourceConstantAlpha = 255,
                    AlphaFormat = NativeWin32.AC_SRC_ALPHA
                };

                NativeWin32.UpdateLayeredWindow(
                    Handle,
                    screenDc,
                    ref topPos,
                    ref size,
                    memDc,
                    ref pointSource,
                    0,
                    ref blend,
                    NativeWin32.ULW_ALPHA);
            }
            finally
            {
                if (oldBitmap != IntPtr.Zero) NativeWin32.SelectObject(memDc, oldBitmap);
                if (hBitmap != IntPtr.Zero) NativeWin32.DeleteObject(hBitmap);
                NativeWin32.DeleteDC(memDc);
                NativeWin32.ReleaseDC(IntPtr.Zero, screenDc);
            }
        }
    }

    /// <summary>
    /// Small topmost floating Squeegee button docked on the Left or Right edge of the desktop monitor.
    /// </summary>
    internal sealed class SqueegeeEdgeButtonForm : Form
    {
        private readonly MonitorSide _side;
        private readonly Button _btn;
        private readonly Action _onClick;

        public SqueegeeEdgeButtonForm(MonitorSide side, Action onClick)
        {
            _side = side;
            _onClick = onClick;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Width = 148;
            Height = 32;
            BackColor = side == MonitorSide.Left ? Color.FromArgb(68, 24, 16) : Color.FromArgb(30, 44, 62);

            Rectangle screen = Screen.PrimaryScreen.WorkingArea;
            Left = side == MonitorSide.Left ? screen.Left + 10 : (screen.Right - Width - 10);
            Top = screen.Top + 10;

            _btn = new Button
            {
                Dock = DockStyle.Fill,
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(248, 250, 252),
                BackColor = BackColor,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                Text = side == MonitorSide.Left ? "Squeegee Left" : "Squeegee Right",
                Cursor = Cursors.Hand
            };
            _btn.FlatAppearance.BorderColor = side == MonitorSide.Left
                ? Color.FromArgb(255, 66, 158)
                : Color.FromArgb(0, 150, 255);
            _btn.FlatAppearance.BorderSize = 1;
            _btn.Click += (s, e) => _onClick();
            Controls.Add(_btn);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= NativeWin32.WS_EX_TOPMOST
                            | NativeWin32.WS_EX_TOOLWINDOW
                            | NativeWin32.WS_EX_NOACTIVATE;
                return cp;
            }
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        public void UpdateCount(int count)
        {
            // Keep clean label without numeric count suffix
        }
    }

    /// <summary>
    /// Native Windows System Tray Flyout displaying two daily gauges (Received vs Sent Slop,
    /// resetting at midnight daily), settings toggles, squeegee buttons, and Dashboard launcher.
    /// </summary>
    internal sealed class TrayGaugeFlyoutForm : Form
    {
        private int _receivedAvg;
        private int _receivedCount;
        private int _sentAvg;
        private int _sentCount;
        private readonly Panel _gaugePanel;
        private readonly CheckBox _chkStartup;
        private readonly CheckBox _chkTeams;
        private readonly CheckBox _chkOutlook;
        private readonly CheckBox _chkSlop;
        private readonly CheckBox _chkNonSlop;

        public bool MonitorTeams { get { return _chkTeams.Checked; } }
        public bool MonitorOutlook { get { return _chkOutlook.Checked; } }
        public bool EnableSlopAnimations { get { return _chkSlop.Checked; } }
        public bool EnableNonSlopAnimations { get { return _chkNonSlop.Checked; } }

        public TrayGaugeFlyoutForm(
            bool initialStartup,
            Action<bool> onStartupChanged,
            Action onOpenDashboard,
            Action onSqueegeeLeft,
            Action onSqueegeeRight,
            Action onShowcase,
            Action onQuit)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Width = 340;
            Height = 368;
            BackColor = Color.FromArgb(22, 24, 29);
            ForeColor = Color.FromArgb(228, 231, 236);
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);

            Label header = new Label
            {
                Text = "Slop Grenade — Daily Gauges (00:00 Reset)",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(249, 250, 251),
                Location = new Point(14, 12),
                Size = new Size(312, 20)
            };
            Controls.Add(header);

            _gaugePanel = new Panel
            {
                Location = new Point(14, 36),
                Size = new Size(312, 114),
                BackColor = Color.FromArgb(17, 19, 23)
            };
            _gaugePanel.Paint += PaintDailyGauges;
            Controls.Add(_gaugePanel);

            // Settings section
            _chkStartup = CreateCheck("Run at Windows startup", 14, 158, initialStartup);
            _chkStartup.CheckedChanged += (s, e) => onStartupChanged(_chkStartup.Checked);
            _chkTeams = CreateCheck("Monitor Microsoft Teams", 14, 182, true);
            _chkOutlook = CreateCheck("Monitor Microsoft Outlook", 14, 206, true);
            _chkSlop = CreateCheck("Slop animations (slop-grenade & ai-cannon)", 14, 230, true);
            _chkNonSlop = CreateCheck("Non-slop animations (sprinkled, polish, human)", 14, 254, true);

            Controls.Add(_chkStartup);
            Controls.Add(_chkTeams);
            Controls.Add(_chkOutlook);
            Controls.Add(_chkSlop);
            Controls.Add(_chkNonSlop);

            Button btnLeft = CreateButton("Squeegee Left", 14, 286, 150, 28, Color.FromArgb(88, 32, 20));
            btnLeft.Click += (s, e) => onSqueegeeLeft();
            Button btnRight = CreateButton("Squeegee Right", 176, 286, 150, 28, Color.FromArgb(42, 62, 84));
            btnRight.Click += (s, e) => onSqueegeeRight();

            Button btnDash = CreateButton("Open Dashboard", 14, 322, 140, 30, Color.FromArgb(40, 45, 55));
            btnDash.Click += (s, e) => { Hide(); onOpenDashboard(); };
            Button btnTest = CreateButton("Test", 162, 322, 78, 30, Color.FromArgb(32, 36, 44));
            btnTest.Click += (s, e) => onShowcase();
            Button btnQuit = CreateButton("Quit", 248, 322, 78, 30, Color.FromArgb(32, 36, 44));
            btnQuit.Click += (s, e) => onQuit();

            Controls.Add(btnLeft);
            Controls.Add(btnRight);
            Controls.Add(btnDash);
            Controls.Add(btnTest);
            Controls.Add(btnQuit);

            Deactivate += (s, e) => Hide();
        }

        private static CheckBox CreateCheck(string text, int x, int y, bool isChecked)
        {
            return new CheckBox
            {
                Text = text,
                Checked = isChecked,
                Location = new Point(x, y),
                Size = new Size(310, 22),
                ForeColor = Color.FromArgb(203, 213, 225)
            };
        }

        private static Button CreateButton(string text, int x, int y, int w, int h, Color bg)
        {
            Button b = new Button
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(w, h),
                FlatStyle = FlatStyle.Flat,
                BackColor = bg,
                ForeColor = Color.FromArgb(243, 244, 246),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = Color.FromArgb(55, 65, 81);
            b.FlatAppearance.BorderSize = 1;
            return b;
        }

        public void UpdateMetrics(int recAvg, int recCount, int sentAvg, int sentCount)
        {
            _receivedAvg = recAvg;
            _receivedCount = recCount;
            _sentAvg = sentAvg;
            _sentCount = sentCount;
            if (IsHandleCreated && Visible)
            {
                _gaugePanel.Invalidate();
            }
        }

        public void ShowAboveTray()
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Left = wa.Right - Width - 12;
            Top = wa.Bottom - Height - 12;
            Show();
            Activate();
            _gaugePanel.Invalidate();
        }

        private void PaintDailyGauges(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            using (Pen borderPen = new Pen(Color.FromArgb(35, 39, 48), 1f))
            {
                g.DrawRectangle(borderPen, 0, 0, _gaugePanel.Width - 1, _gaugePanel.Height - 1);
            }

            DrawSingleGauge(g, 18, 14, "Received (In)", _receivedAvg, _receivedCount, Color.FromArgb(140, 58, 43));
            DrawSingleGauge(g, 170, 14, "Sent (Out)", _sentAvg, _sentCount, Color.FromArgb(59, 89, 120));
        }

        private static Color WhiteToPurple(int scorePercent)
        {
            double t = Math.Max(0.0, Math.Min(100.0, scorePercent)) / 100.0;
            int r = (int)Math.Round(255 + (147 - 255) * t);
            int gr = (int)Math.Round(255 + (51 - 255) * t);
            int b = (int)Math.Round(255 + (234 - 255) * t);
            return Color.FromArgb(255, r, gr, b);
        }

        private static void DrawSingleGauge(Graphics g, int x, int y, string label, int avgScore, int count, Color unused)
        {
            Rectangle arcRect = new Rectangle(x + 12, y + 18, 96, 96);
            Color levelColor = WhiteToPurple(avgScore);
            using (Pen trackPen = new Pen(Color.FromArgb(38, 42, 51), 11f))
            using (Pen valPen = new Pen(levelColor, 11f))
            using (Pen markerPen = new Pen(levelColor, 2.5f))
            using (SolidBrush markerBrush = new SolidBrush(levelColor))
            using (Font lblFont = new Font("Segoe UI", 8.2f, FontStyle.Bold))
            using (Font numFont = new Font("Segoe UI", 14f, FontStyle.Bold))
            using (Font subFont = new Font("Segoe UI", 7.8f, FontStyle.Regular))
            using (SolidBrush mutedBrush = new SolidBrush(Color.FromArgb(141, 149, 165)))
            {
                g.DrawString(label, lblFont, mutedBrush, x + 16, y - 2);
                g.DrawArc(trackPen, arcRect, 180f, 180f);
                float clamped = Math.Max(0f, Math.Min(100f, avgScore));
                float sweep = (clamped / 100f) * 180f;
                if (sweep > 1f)
                {
                    g.DrawArc(valPen, arcRect, 180f, sweep);
                }

                // 0-100% Marker on the gauge arc
                double angleRad = Math.PI - (clamped / 100.0) * Math.PI;
                float cx = x + 60f;
                float cy = y + 66f;
                float r = 48f;
                float mx = cx + (float)(r * Math.Cos(angleRad));
                float my = cy - (float)(r * Math.Sin(angleRad));
                g.FillEllipse(markerBrush, mx - 5f, my - 5f, 10f, 10f);

                StringFormat sf = new StringFormat { Alignment = StringAlignment.Center };
                g.DrawString(avgScore + "%", numFont, markerBrush, x + 60, y + 36, sf);
                g.DrawString(count + " msgs today", subFont, mutedBrush, x + 60, y + 66, sf);
            }
        }
    }

    internal static class Program
    {
        private const string RunRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunRegistryValueName = "SlopGrenade";

        private static DesktopOverlayForm _overlay;
        private static SqueegeeEdgeButtonForm _leftSqueegeeBtn;
        private static SqueegeeEdgeButtonForm _rightSqueegeeBtn;
        private static TrayGaugeFlyoutForm _trayFlyout;
        private static NotifyIcon _trayIcon;
        private static Process _daemonProcess;
        private static volatile bool _running = true;
        private static int _lastSeq = 0;
        private static string _apiBase = "http://127.0.0.1:8090";

        // Daily midnight-resetting gauge accumulators
        private static DateTime _activeDay = DateTime.Now.Date;
        private static int _dailyRecSum = 175;
        private static int _dailyRecCount = 2;
        private static int _dailySentSum = 48;
        private static int _dailySentCount = 1;

        [STAThread]
        private static void Main(string[] args)
        {
            NativeWin32.SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Enable Run at Windows Startup by default if not yet configured
            if (!HasStartupPreferenceRecorded())
            {
                SetRunAtStartup(true);
            }

            EnsureRustDaemonRunning();

            _overlay = new DesktopOverlayForm();
            _leftSqueegeeBtn = new SqueegeeEdgeButtonForm(MonitorSide.Left, () => TriggerSqueegee(MonitorSide.Left));
            _rightSqueegeeBtn = new SqueegeeEdgeButtonForm(MonitorSide.Right, () => TriggerSqueegee(MonitorSide.Right));

            _overlay.SlopCountsChanged += (l, r) =>
            {
                _leftSqueegeeBtn.UpdateCount(l);
                _rightSqueegeeBtn.UpdateCount(r);
            };

            _trayFlyout = new TrayGaugeFlyoutForm(
                IsRunAtStartupEnabled(),
                SetRunAtStartup,
                () => Process.Start(_apiBase + "/"),
                () => TriggerSqueegee(MonitorSide.Left),
                () => TriggerSqueegee(MonitorSide.Right),
                RunDesktopShowcase,
                () =>
                {
                    _trayIcon.Visible = false;
                    Application.Exit();
                });

            _overlay.Show();
            _leftSqueegeeBtn.Show();
            _rightSqueegeeBtn.Show();

            SetupSystemTrayIcon();
            RefreshDailyTrayMetrics();

            // 60 FPS native desktop overlay timer + midnight reset check
            System.Windows.Forms.Timer renderTimer = new System.Windows.Forms.Timer { Interval = 16 };
            renderTimer.Tick += (s, e) =>
            {
                CheckMidnightReset();
                _overlay.StepAndRender();
            };
            renderTimer.Start();

            // Start SSE subscriber thread listening to the background Rust daemon
            Thread sseThread = new Thread(SseListenerLoop) { IsBackground = true };
            sseThread.Start();

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--showcase")
                {
                    RunDesktopShowcase();
                }
            }

            Application.Run();
            _running = false;
            StopManagedDaemon();
        }

        private static void CheckMidnightReset()
        {
            DateTime today = DateTime.Now.Date;
            if (today != _activeDay)
            {
                _activeDay = today;
                _dailyRecSum = 0;
                _dailyRecCount = 0;
                _dailySentSum = 0;
                _dailySentCount = 0;
                RefreshDailyTrayMetrics();
            }
        }

        private static void RecordDailyMessageMetric(MonitorSide side, int score)
        {
            CheckMidnightReset();
            if (side == MonitorSide.Left)
            {
                _dailyRecCount++;
                _dailyRecSum += score;
            }
            else
            {
                _dailySentCount++;
                _dailySentSum += score;
            }
            RefreshDailyTrayMetrics();
        }

        private static void RefreshDailyTrayMetrics()
        {
            int recAvg = _dailyRecCount > 0 ? (_dailyRecSum / _dailyRecCount) : 0;
            int sentAvg = _dailySentCount > 0 ? (_dailySentSum / _dailySentCount) : 0;
            if (_trayFlyout != null)
            {
                _trayFlyout.UpdateMetrics(recAvg, _dailyRecCount, sentAvg, _dailySentCount);
            }
            if (_trayIcon != null)
            {
                _trayIcon.Icon = CreateDualGaugeTrayIcon(recAvg, sentAvg);
                _trayIcon.Text = string.Format("Slop Grenade — Today In: {0}/100 ({1}) | Out: {2}/100 ({3})",
                    recAvg, _dailyRecCount, sentAvg, _dailySentCount);
            }
        }

        private static bool HasStartupPreferenceRecorded()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunRegistryKey, false))
                {
                    return k != null && k.GetValue(RunRegistryValueName) != null;
                }
            }
            catch { return false; }
        }

        private static bool IsRunAtStartupEnabled()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunRegistryKey, false))
                {
                    return k != null && k.GetValue(RunRegistryValueName) != null;
                }
            }
            catch { return false; }
        }

        private static void SetRunAtStartup(bool enabled)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunRegistryKey, true))
                {
                    if (k == null) return;
                    if (enabled)
                    {
                        k.SetValue(RunRegistryValueName, "\"" + Application.ExecutablePath + "\"");
                    }
                    else if (k.GetValue(RunRegistryValueName) != null)
                    {
                        k.DeleteValue(RunRegistryValueName, false);
                    }
                }
            }
            catch { }
        }

        private static void SetupSystemTrayIcon()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Open Daily Gauges & Settings", null, (s, e) => _trayFlyout.ShowAboveTray());
            menu.Items.Add("Open Dashboard (http://127.0.0.1:8090/)", null, (s, e) => Process.Start(_apiBase + "/"));
            menu.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem startupItem = new ToolStripMenuItem("Run at Windows Startup")
            {
                Checked = IsRunAtStartupEnabled(),
                CheckOnClick = true
            };
            startupItem.CheckedChanged += (s, e) => SetRunAtStartup(startupItem.Checked);
            menu.Items.Add(startupItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Throw Incoming Slop Grenade (Brown-Red, Left)", null, (s, e) =>
            {
                RecordDailyMessageMetric(MonitorSide.Left, 96);
                _overlay.SpawnAnimation(AnimationTier.SlopGrenade, MonitorSide.Left, 96, "Colleague (Teams)", "Incoming Slop Grenade");
            });
            menu.Items.Add("Throw Outgoing Slop Grenade (Brown-Blue, Right)", null, (s, e) =>
            {
                RecordDailyMessageMetric(MonitorSide.Right, 98);
                _overlay.SpawnAnimation(AnimationTier.SlopGrenade, MonitorSide.Right, 98, "You (Outgoing)", "My Outgoing Slop Grenade");
            });
            menu.Items.Add("Burst 5 Random Fruits (20 Varieties)", null, (s, e) => BurstDesktopFruits(5));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Squeegee Left Monitor Edge (Brown-Red)", null, (s, e) => TriggerSqueegee(MonitorSide.Left));
            menu.Items.Add("Squeegee Right Monitor Edge (Brown-Blue)", null, (s, e) => TriggerSqueegee(MonitorSide.Right));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Slop Grenade", null, (s, e) =>
            {
                _trayIcon.Visible = false;
                Application.Exit();
            });

            _trayIcon = new NotifyIcon
            {
                Icon = CreateDualGaugeTrayIcon(87, 48),
                Text = "Slop Grenade — Click for Daily In/Out Gauges & Settings",
                ContextMenuStrip = menu,
                Visible = true
            };
            _trayIcon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    if (_trayFlyout.Visible) _trayFlyout.Hide();
                    else _trayFlyout.ShowAboveTray();
                }
            };
        }

        /// <summary>
        /// Renders two vertical gauges directly inside the 32x32 System Tray icon:
        /// Left bar = Received Slop Today (Brown-Red), Right bar = Sent Slop Today (Brown-Blue).
        /// </summary>
        private static Icon CreateDualGaugeTrayIcon(int inAvg, int outAvg)
        {
            using (Bitmap bmp = new Bitmap(32, 32, PixelFormat.Format32bppArgb))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(245, 20, 23, 28)))
                using (Pen border = new Pen(Color.FromArgb(255, 55, 65, 81), 1.5f))
                using (SolidBrush track = new SolidBrush(Color.FromArgb(255, 38, 42, 51)))
                using (SolidBrush inBrush = new SolidBrush(Color.FromArgb(255, 168, 66, 48)))
                using (SolidBrush outBrush = new SolidBrush(Color.FromArgb(255, 68, 108, 148)))
                {
                    g.FillRectangle(bg, 1, 1, 30, 30);
                    g.DrawRectangle(border, 1, 1, 29, 29);

                    // Left gauge track & fill (Received In)
                    g.FillRectangle(track, 5, 5, 9, 22);
                    int inH = Math.Max(2, Math.Min(22, (int)Math.Round((inAvg / 100.0) * 22.0)));
                    g.FillRectangle(inBrush, 5, 27 - inH, 9, inH);

                    // Right gauge track & fill (Sent Out)
                    g.FillRectangle(track, 18, 5, 9, 22);
                    int outH = Math.Max(2, Math.Min(22, (int)Math.Round((outAvg / 100.0) * 22.0)));
                    g.FillRectangle(outBrush, 18, 27 - outH, 9, outH);
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private static void TriggerSqueegee(MonitorSide side)
        {
            _overlay.StartSqueegeeWipe(side);
            string sideStr = side == MonitorSide.Left ? "left" : "right";
            TriggerPostAsync("/api/v1/squeegee", "{\"side\":\"" + sideStr + "\"}");
        }

        private static void BurstDesktopFruits(int count)
        {
            Random r = new Random();
            for (int i = 0; i < count; i++)
            {
                MonitorSide side = (i % 2 == 0) ? MonitorSide.Left : MonitorSide.Right;
                int fruitIdx = r.Next(DesktopOverlayForm.FruitNames.Length);
                _overlay.SpawnAnimation(AnimationTier.InnocentFruit, side, 45, DesktopOverlayForm.FruitNames[fruitIdx], "Mild AI Assist", fruitIdx);
            }
        }

        private static void RunDesktopShowcase()
        {
            _overlay.SpawnAnimation(AnimationTier.SlopGrenade, MonitorSide.Left, 96, "Incoming Slop Grenade", "Brown-Red Left Bezel");
            _overlay.SpawnAnimation(AnimationTier.SlopGrenade, MonitorSide.Right, 98, "Your Thrown Grenade", "Brown-Blue Right Bezel");
            BurstDesktopFruits(4);
            _overlay.SpawnAnimation(AnimationTier.PeacefulCloud, MonitorSide.Left, 26, "Peaceful Cloud", "Calm Note");
            _overlay.SpawnAnimation(AnimationTier.HumanSparkle, MonitorSide.Right, 5, "Human Sparkle", "Real Human");
        }

        private static void EnsureRustDaemonRunning()
        {
            if (IsDaemonHealthy()) return;

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] candidates = new string[]
            {
                Path.Combine(baseDir, "slop-grenade.exe"),
                Path.Combine(baseDir, @"..\rust\target\release\slop-grenade.exe"),
                Path.Combine(baseDir, @"..\rust\target\debug\slop-grenade.exe")
            };

            foreach (string exe in candidates)
            {
                if (File.Exists(exe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = Path.GetFullPath(exe),
                        WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(exe)),
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    string webBuild = Path.GetFullPath(Path.Combine(baseDir, @"..\web\build"));
                    if (Directory.Exists(webBuild))
                    {
                        psi.EnvironmentVariables["WEB_ASSET_DIR"] = webBuild;
                    }
                    _daemonProcess = Process.Start(psi);
                    break;
                }
            }
        }

        private static bool IsDaemonHealthy()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(_apiBase + "/api/v1/health");
                req.Timeout = 1200;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void StopManagedDaemon()
        {
            try
            {
                if (_daemonProcess != null && !_daemonProcess.HasExited)
                {
                    _daemonProcess.Kill();
                }
            }
            catch { }
        }

        private static void TriggerPostAsync(string path, string jsonBody)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(_apiBase + path);
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
                    req.ContentLength = bytes.Length;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(bytes, 0, bytes.Length);
                    }
                    using (WebResponse resp = req.GetResponse()) { }
                }
                catch { }
            });
        }

        private static void SseListenerLoop()
        {
            while (_running)
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(_apiBase + "/api/v1/events/stream");
                    req.Method = "GET";
                    req.Timeout = Timeout.Infinite;
                    req.ReadWriteTimeout = Timeout.Infinite;
                    using (WebResponse resp = req.GetResponse())
                    using (Stream stream = resp.GetResponseStream())
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        while (_running && !reader.EndOfStream)
                        {
                            string line = reader.ReadLine();
                            if (line != null && line.StartsWith("data:"))
                            {
                                string json = line.Substring(5).Trim();
                                HandleSsePayload(json);
                            }
                        }
                    }
                }
                catch
                {
                    Thread.Sleep(2500);
                }
            }
        }

        private static void HandleSsePayload(string json)
        {
            try
            {
                Match seqMatch = Regex.Match(json, "\"sequence\"\\s*:\\s*(\\d+)");
                if (seqMatch.Success)
                {
                    int seq = int.Parse(seqMatch.Groups[1].Value);
                    if (seq <= _lastSeq) return;
                    _lastSeq = seq;
                }

                Match squeegeeMatch = Regex.Match(json, "\"squeegeeSide\"\\s*:\\s*\"(left|right)\"");
                if (squeegeeMatch.Success)
                {
                    MonitorSide sSide = squeegeeMatch.Groups[1].Value == "right" ? MonitorSide.Right : MonitorSide.Left;
                    _overlay.BeginInvoke(new Action(() => _overlay.StartSqueegeeWipe(sSide)));
                    return;
                }

                string tierStr = ExtractJsonString(json, "tier");
                string sideStr = ExtractJsonString(json, "monitorSide");
                string appStr = ExtractJsonString(json, "app");
                string sender = ExtractJsonString(json, "sender");
                string subject = ExtractJsonString(json, "subjectOrTopic");
                int score = ExtractJsonInt(json, "slopScore", 50);

                AnimationTier tier = AnimationTier.HumanSparkle;
                if (tierStr == "slop_grenade") tier = AnimationTier.SlopGrenade;
                else if (tierStr == "slop_splat") tier = AnimationTier.SlopSplat;
                else if (tierStr == "innocent_fruit") tier = AnimationTier.InnocentFruit;
                else if (tierStr == "peaceful_cloud") tier = AnimationTier.PeacefulCloud;

                MonitorSide side = sideStr == "right" ? MonitorSide.Right : MonitorSide.Left;

                _overlay.BeginInvoke(new Action(() =>
                {
                    RecordDailyMessageMetric(side, score);
                    if (appStr == "teams" && !_trayFlyout.MonitorTeams) return;
                    if (appStr == "outlook" && !_trayFlyout.MonitorOutlook) return;
                    bool isSlop = (tier == AnimationTier.SlopGrenade || tier == AnimationTier.SlopSplat);
                    if (isSlop && !_trayFlyout.EnableSlopAnimations) return;
                    if (!isSlop && !_trayFlyout.EnableNonSlopAnimations) return;

                    _overlay.SpawnAnimation(tier, side, score, sender, subject);
                }));
            }
            catch { }
        }

        private static string ExtractJsonString(string json, string key)
        {
            Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }

        private static int ExtractJsonInt(string json, string key, int fallback)
        {
            Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*(\\d+)");
            return m.Success ? int.Parse(m.Groups[1].Value) : fallback;
        }
    }
}
