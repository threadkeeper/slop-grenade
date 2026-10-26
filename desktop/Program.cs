// Program.cs
// Slop Grenade desktop companion: system-tray app + full-screen click-through
// effects overlay. Listens to the local Rust daemon's Server-Sent Events and
// turns each scored Teams/Outlook message into an on-screen effect:
//   human (0-19)        -> a barely-there crystal twinkle
//   polish (20-39)      -> smoke plumes rolling in from the edge
//   sprinkled (40-59)   -> a 3D fruit tumbling across in slow motion
//   ai-cannon (60-79)   -> a goo cannonball splatting the edge
//   slop-grenade (80+)  -> a cute grenade lobbed in bullet-time that blows up
//                          and splatters the edge (flies gather if left there)
// Incoming slop lands on the LEFT edge (pink), your own on the RIGHT (blue).
//
// Build (C# 5 / .NET Framework 4, no extra packages):
//   csc /target:winexe /optimize+ /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll
//       /out:slop-grenade-overlay.exe /recurse:desktop\*.cs

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SlopGrenadeDesktop
{
    internal static class Program
    {
        private const string RunRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunRegistryValueName = "SlopGrenade";

        private static OverlayForm _overlay;
        private static TrayFlyout _flyout;
        private static NotifyIcon _trayIcon;
        private static AudioEngine _audio;
        private static Settings _settings;
        private static Process _daemonProcess;
        private static volatile bool _running = true;
        private static long _lastSeq;
        private static readonly string ApiBase = "http://127.0.0.1:8090";

        // time of the last squeegee started from this app, per side, so the
        // daemon's echo of the same wipe is not played twice
        private static readonly DateTime[] _localWipeAt = new DateTime[] { DateTime.MinValue, DateTime.MinValue };

        private static DateTime _activeDay = DateTime.Now.Date;
        private static int _dailyRecAi, _dailyRecCount, _dailySentAi, _dailySentCount;

        /// <summary>Scores at or above this read as AI-written (same threshold as the dashboard).</summary>
        private const int AiWrittenThreshold = 40;

        [STAThread]
        private static void Main(string[] args)
        {
            NativeMethods.SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (Mutex single = new Mutex(true, "SlopGrenadeDesktopOverlay", out createdNew))
            {
                if (!createdNew)
                {
                    // another instance already owns the tray icon
                    return;
                }
                Run(args);
            }
        }

        private static void Run(string[] args)
        {
            _settings = Settings.Load();
            if (!HasStartupPreferenceRecorded()) SetRunAtStartup(true);

            EnsureRustDaemonRunning();

            _audio = new AudioEngine();
            _overlay = new OverlayForm(_settings.FlyDelaySeconds);
            ApplySettings();

            _flyout = new TrayFlyout(_settings, IsRunAtStartupEnabled, SetRunAtStartup, OnCommand);
            _overlay.Show();
            SetupSystemTrayIcon();
            RefreshDailyTrayMetrics();

            System.Windows.Forms.Timer midnight = new System.Windows.Forms.Timer();
            midnight.Interval = 30000;
            midnight.Tick += delegate { CheckMidnightReset(); };
            midnight.Start();

            // Ping WorkIQ through the daemon every minute so each new message animates.
            System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer();
            poll.Interval = 60000;
            poll.Tick += delegate { TriggerPostAsync("/api/v1/scan/now", "{\"useLuna\":false}"); };
            poll.Start();
            TriggerPostAsync("/api/v1/scan/now", "{\"useLuna\":false}");

            Thread sse = new Thread(SseListenerLoop);
            sse.IsBackground = true;
            sse.Start();

            foreach (string a in args)
            {
                if (a == "--showcase") RunDesktopShowcase();
            }

            Application.Run();
            _running = false;
            _audio.Dispose();
            StopManagedDaemon();
        }

        private static void ApplySettings()
        {
            _audio.Volume = _settings.Volume / 100f;
            _audio.SetEnabled(_settings.SoundEnabled);
            _overlay.Sfx = _settings.SoundEnabled ? _audio : null;
            _overlay.Wake();
        }

        private static void OnCommand(string id)
        {
            switch (id)
            {
                case "settings": ApplySettings(); break;
                case "squeegee-left": TriggerSqueegee(Side.Left); break;
                case "squeegee-right": TriggerSqueegee(Side.Right); break;
                case "dashboard": OpenDashboard(); break;
                case "test": RunDesktopShowcase(); break;
                case "quit": Quit(); break;
            }
        }

        private static void Quit()
        {
            _trayIcon.Visible = false;
            Application.Exit();
        }

        private static void OpenDashboard()
        {
            try { Process.Start(ApiBase + "/"); }
            catch (Exception) { }
        }

        // ------------------------------------------------------------------ daily gauges

        private static void CheckMidnightReset()
        {
            DateTime today = DateTime.Now.Date;
            if (today == _activeDay) return;
            _activeDay = today;
            _dailyRecAi = _dailyRecCount = _dailySentAi = _dailySentCount = 0;
            RefreshDailyTrayMetrics();
        }

        private static void RecordDailyMessageMetric(Side side, int score)
        {
            CheckMidnightReset();
            bool aiWritten = score >= AiWrittenThreshold;
            if (side == Side.Left) { _dailyRecCount++; if (aiWritten) _dailyRecAi++; }
            else { _dailySentCount++; if (aiWritten) _dailySentAi++; }
            RefreshDailyTrayMetrics();
        }

        private static void RefreshDailyTrayMetrics()
        {
            // Share of today's person-written messages that read as AI-written.
            int recPct = _dailyRecCount > 0 ? (int)Math.Round(100.0 * _dailyRecAi / _dailyRecCount) : 0;
            int sentPct = _dailySentCount > 0 ? (int)Math.Round(100.0 * _dailySentAi / _dailySentCount) : 0;
            if (_flyout != null) _flyout.UpdateMetrics(recPct, _dailyRecCount, sentPct, _dailySentCount);
            if (_trayIcon != null)
            {
                string tip = string.Format("Slop Grenade: In {0}% AI ({1}), Out {2}% AI ({3})", recPct, _dailyRecCount, sentPct, _dailySentCount);
                _trayIcon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            }
        }

        // ------------------------------------------------------------------ startup registration

        private static bool HasStartupPreferenceRecorded()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\SlopGrenade", false))
                {
                    if (k != null && k.GetValue("StartupPreference") != null) return true;
                }
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunRegistryKey, false))
                {
                    return k != null && k.GetValue(RunRegistryValueName) != null;
                }
            }
            catch (Exception) { return false; }
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
            catch (Exception) { return false; }
        }

        private static void SetRunAtStartup(bool enabled)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunRegistryKey, true))
                {
                    if (k == null) return;
                    if (enabled) k.SetValue(RunRegistryValueName, "\"" + Application.ExecutablePath + "\"");
                    else if (k.GetValue(RunRegistryValueName) != null) k.DeleteValue(RunRegistryValueName, false);
                }
                using (RegistryKey s = Registry.CurrentUser.CreateSubKey(@"Software\SlopGrenade"))
                {
                    if (s != null) s.SetValue("StartupPreference", enabled ? 1 : 0, RegistryValueKind.DWord);
                }
            }
            catch (Exception) { }
        }

        // ------------------------------------------------------------------ tray

        private static void SetupSystemTrayIcon()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Open control panel", null, delegate { _flyout.ShowAboveTray(); });
            menu.Items.Add("Open dashboard (" + ApiBase + "/)", null, delegate { OpenDashboard(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Lob a test grenade at the left edge", null, delegate { _overlay.Trigger(EffectTier.SlopGrenade, Side.Left); });
            menu.Items.Add("Lob a test grenade at the right edge", null, delegate { _overlay.Trigger(EffectTier.SlopGrenade, Side.Right); });
            menu.Items.Add("Toss some fruit", null, delegate { BurstDesktopFruits(4); });
            menu.Items.Add("Full test fire", null, delegate { RunDesktopShowcase(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Squeegee left edge", null, delegate { TriggerSqueegee(Side.Left); });
            menu.Items.Add("Squeegee right edge", null, delegate { TriggerSqueegee(Side.Right); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Slop Grenade", null, delegate { Quit(); });

            Bitmap iconArt = SteampunkArt.GrenadeIcon(32);
            IntPtr hIcon = iconArt.GetHicon();
            _trayIcon = new NotifyIcon();
            _trayIcon.Icon = Icon.FromHandle(hIcon);
            _trayIcon.Text = "Slop Grenade: click for gauges and squeegee";
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.Visible = true;
            _trayIcon.MouseClick += delegate(object s, MouseEventArgs e)
            {
                if (e.Button != MouseButtons.Left) return;
                if (_flyout.Visible) _flyout.Hide();
                // the press on the tray already closed the panel; don't reopen it on release
                else if ((DateTime.UtcNow - _flyout.LastAutoHide).TotalMilliseconds > 300) _flyout.ShowAboveTray();
            };
        }

        private static void TriggerSqueegee(Side side)
        {
            _localWipeAt[side == Side.Left ? 0 : 1] = DateTime.UtcNow;
            _overlay.Squeegee(side);
            TriggerPostAsync("/api/v1/squeegee", "{\"side\":\"" + (side == Side.Left ? "left" : "right") + "\"}");
        }

        private static void BurstDesktopFruits(int count)
        {
            for (int i = 0; i < count; i++)
            {
                _overlay.TriggerLater(i * 0.6f, EffectTier.InnocentFruit, i % 2 == 0 ? Side.Left : Side.Right);
            }
        }

        /// <summary>A short "test fire" sequence showing every effect.</summary>
        private static void RunDesktopShowcase()
        {
            _overlay.TriggerLater(0.0f, EffectTier.PeacefulCloud, Side.Right);
            _overlay.TriggerLater(0.3f, EffectTier.SlopGrenade, Side.Left);
            _overlay.TriggerLater(1.2f, EffectTier.SlopSplat, Side.Right);
            _overlay.TriggerLater(2.0f, EffectTier.HumanSparkle, Side.Left);
            _overlay.TriggerLater(4.2f, EffectTier.InnocentFruit, Side.Left);
            _overlay.TriggerLater(4.8f, EffectTier.InnocentFruit, Side.Right);
            _overlay.TriggerLater(5.6f, EffectTier.SlopGrenade, Side.Right);
            _overlay.TriggerLater(6.4f, EffectTier.InnocentFruit, Side.Left);
            _overlay.TriggerLater(7.5f, EffectTier.PeacefulCloud, Side.Left);
            _overlay.TriggerLater(8.0f, EffectTier.HumanSparkle, Side.Right);
        }

        // ------------------------------------------------------------------ daemon

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
                if (!File.Exists(exe)) continue;
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = Path.GetFullPath(exe);
                psi.WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(exe));
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                string webBuild = Path.GetFullPath(Path.Combine(baseDir, @"..\web\build"));
                if (Directory.Exists(webBuild)) psi.EnvironmentVariables["WEB_ASSET_DIR"] = webBuild;
                try { _daemonProcess = Process.Start(psi); }
                catch (Exception) { }
                break;
            }
        }

        private static bool IsDaemonHealthy()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(ApiBase + "/api/v1/health");
                req.Timeout = 1200;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static void StopManagedDaemon()
        {
            try
            {
                if (_daemonProcess != null && !_daemonProcess.HasExited) _daemonProcess.Kill();
            }
            catch (Exception) { }
        }

        private static void TriggerPostAsync(string path, string jsonBody)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(ApiBase + path);
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
                    req.ContentLength = bytes.Length;
                    using (Stream s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                    using (WebResponse resp = req.GetResponse()) { }
                }
                catch (Exception) { }
            });
        }

        // ------------------------------------------------------------------ SSE

        private static void SseListenerLoop()
        {
            while (_running)
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(ApiBase + "/api/v1/events/stream");
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
                            if (line != null && line.StartsWith("data:")) HandleSsePayload(line.Substring(5).Trim());
                        }
                    }
                }
                catch (Exception)
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
                    long seq = long.Parse(seqMatch.Groups[1].Value);
                    if (seq <= _lastSeq) return;
                    _lastSeq = seq;
                }
                Match sq = Regex.Match(json, "\"squeegeeSide\"\\s*:\\s*\"(left|right)\"");
                if (sq.Success)
                {
                    Side sSide = sq.Groups[1].Value == "right" ? Side.Right : Side.Left;
                    _overlay.BeginInvoke(new Action(delegate
                    {
                        // skip the echo of a wipe this app just started itself
                        if ((DateTime.UtcNow - _localWipeAt[sSide == Side.Left ? 0 : 1]).TotalMilliseconds < 2500) return;
                        _overlay.Squeegee(sSide);
                    }));
                    return;
                }
                string tierStr = ExtractJsonString(json, "tier");
                string sideStr = ExtractJsonString(json, "monitorSide");
                string appStr = ExtractJsonString(json, "app");
                int score = ExtractJsonInt(json, "slopScore", 50);
                // Automated mail (no-reply, calendar responses, bots) is not anyone's writing.
                bool automated = ExtractJsonString(json, "summary").StartsWith("Automated / machine-generated response", StringComparison.Ordinal);

                EffectTier tier = EffectTier.HumanSparkle;
                if (tierStr == "slop_grenade") tier = EffectTier.SlopGrenade;
                else if (tierStr == "slop_splat") tier = EffectTier.SlopSplat;
                else if (tierStr == "innocent_fruit") tier = EffectTier.InnocentFruit;
                else if (tierStr == "peaceful_cloud") tier = EffectTier.PeacefulCloud;
                Side side = sideStr == "right" ? Side.Right : Side.Left;

                _overlay.BeginInvoke(new Action(delegate
                {
                    if (!automated) RecordDailyMessageMetric(side, score);
                    if (appStr == "teams" && !_settings.MonitorTeams) return;
                    if (appStr == "outlook" && !_settings.MonitorOutlook) return;
                    bool isSlop = tier == EffectTier.SlopGrenade || tier == EffectTier.SlopSplat;
                    if (isSlop && !_settings.SlopEffects) return;
                    if (!isSlop && !_settings.CalmEffects) return;
                    _overlay.Trigger(tier, side);
                }));
            }
            catch (Exception) { }
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
