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
//   csc /target:winexe /optimize+ /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll
//       /out:slop-grenade-overlay.exe /recurse:desktop\*.cs

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
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
        private static int _testSeq;
        private static readonly HashSet<string> _seenMessageIds = new HashSet<string>();
        private static readonly object _resetLock = new object();
        private static long _resetEpoch, _resetGeneration;
        private static readonly LocalDashboard Dashboard = new LocalDashboard(Environment.GetEnvironmentVariable("HTTP_BIND"));
        private static readonly string ApiBase = Dashboard.ApiBase;

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
                case "gmail-signin": OpenAccountDashboard("gmail-signin"); break;
                case "gmail-signout": OpenAccountDashboard("gmail-signout"); break;
                case "m365-signin": OpenAccountDashboard("m365-signin"); break;
                case "m365-signout": OpenAccountDashboard("m365-signout"); break;
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

        private static void OpenAccountDashboard(string action)
        {
            try
            {
                Action<string> open = delegate(string url) { Process.Start(url); };
                switch (action)
                {
                    case "gmail-signin": Dashboard.OpenGmailSignIn(open); break;
                    case "gmail-signout": Dashboard.OpenGmailSignOut(open); break;
                    case "m365-signin": Dashboard.OpenM365SignIn(open); break;
                    case "m365-signout": Dashboard.OpenM365SignOut(open); break;
                    default: return;
                }
            }
            catch (Win32Exception) { ShowAccountDashboardError(); }
            catch (InvalidOperationException) { ShowAccountDashboardError(); }
        }

        private static void ShowAccountDashboardError()
        {
            MessageBox.Show("Could not open your browser. Open " + ApiBase + "/ in your browser to manage account connections.",
                "Manage accounts", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
            menu.Items.Add("Sign in to Microsoft 365", null, delegate { OpenAccountDashboard("m365-signin"); });
            menu.Items.Add("Sign out of Microsoft 365", null, delegate { OpenAccountDashboard("m365-signout"); });
            menu.Items.Add("Sign in to Gmail", null, delegate { OpenAccountDashboard("gmail-signin"); });
            menu.Items.Add("Sign out of Gmail", null, delegate { OpenAccountDashboard("gmail-signout"); });
            ToolStripMenuItem appleMail = new ToolStripMenuItem("Apple Mail (Coming soon)");
            appleMail.Enabled = false;
            menu.Items.Add(appleMail);
            ToolStripMenuItem yahooMail = new ToolStripMenuItem("Yahoo Mail (Coming soon)");
            yahooMail.Enabled = false;
            menu.Items.Add(yahooMail);
            menu.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem watchTeams = new ToolStripMenuItem("Watch Microsoft Teams") { Name = "watch-teams", CheckOnClick = true };
            watchTeams.Click += delegate { _settings.MonitorTeams = watchTeams.Checked; _settings.Save(); };
            menu.Items.Add(watchTeams);
            ToolStripMenuItem watchOutlook = new ToolStripMenuItem("Watch Outlook mail") { Name = "watch-outlook", CheckOnClick = true };
            watchOutlook.Click += delegate { _settings.MonitorOutlook = watchOutlook.Checked; _settings.Save(); };
            menu.Items.Add(watchOutlook);
            ToolStripMenuItem watchGmail = new ToolStripMenuItem("Watch Gmail") { Name = "watch-gmail", CheckOnClick = true };
            watchGmail.Click += delegate { _settings.MonitorGmail = watchGmail.Checked; _settings.Save(); };
            menu.Items.Add(watchGmail);
            menu.Opening += delegate
            {
                watchTeams.Checked = _settings.MonitorTeams;
                watchOutlook.Checked = _settings.MonitorOutlook;
                watchGmail.Checked = _settings.MonitorGmail;
            };
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Lob a test grenade at the left edge", null, delegate { _overlay.Trigger(EffectTier.SlopGrenade, Side.Left, BuildTestEffectMessage(EffectTier.SlopGrenade, Side.Left)); });
            menu.Items.Add("Lob a test grenade at the right edge", null, delegate { _overlay.Trigger(EffectTier.SlopGrenade, Side.Right, BuildTestEffectMessage(EffectTier.SlopGrenade, Side.Right)); });
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
                Side side = i % 2 == 0 ? Side.Left : Side.Right;
                _overlay.TriggerLater(i * 0.6f, EffectTier.InnocentFruit, side, BuildTestEffectMessage(EffectTier.InnocentFruit, side));
            }
        }

        /// <summary>A short "test fire" sequence showing every effect.</summary>
        private static void RunDesktopShowcase()
        {
            _overlay.TriggerLater(0.0f, EffectTier.PeacefulCloud, Side.Right, BuildTestEffectMessage(EffectTier.PeacefulCloud, Side.Right));
            _overlay.TriggerLater(0.3f, EffectTier.SlopGrenade, Side.Left, BuildTestEffectMessage(EffectTier.SlopGrenade, Side.Left));
            _overlay.TriggerLater(1.2f, EffectTier.SlopSplat, Side.Right, BuildTestEffectMessage(EffectTier.SlopSplat, Side.Right));
            _overlay.TriggerLater(2.0f, EffectTier.HumanSparkle, Side.Left, BuildTestEffectMessage(EffectTier.HumanSparkle, Side.Left));
            _overlay.TriggerLater(4.2f, EffectTier.InnocentFruit, Side.Left, BuildTestEffectMessage(EffectTier.InnocentFruit, Side.Left));
            _overlay.TriggerLater(4.8f, EffectTier.InnocentFruit, Side.Right, BuildTestEffectMessage(EffectTier.InnocentFruit, Side.Right));
            _overlay.TriggerLater(5.6f, EffectTier.SlopGrenade, Side.Right, BuildTestEffectMessage(EffectTier.SlopGrenade, Side.Right));
            _overlay.TriggerLater(6.4f, EffectTier.InnocentFruit, Side.Left, BuildTestEffectMessage(EffectTier.InnocentFruit, Side.Left));
            _overlay.TriggerLater(7.5f, EffectTier.PeacefulCloud, Side.Left, BuildTestEffectMessage(EffectTier.PeacefulCloud, Side.Left));
            _overlay.TriggerLater(8.0f, EffectTier.HumanSparkle, Side.Right, BuildTestEffectMessage(EffectTier.HumanSparkle, Side.Right));
        }

        private static EffectMessage BuildTestEffectMessage(EffectTier tier, Side side)
        {
            int seq = Interlocked.Increment(ref _testSeq);
            string tierName = tier == EffectTier.SlopGrenade ? "slop_grenade"
                : tier == EffectTier.SlopSplat ? "slop_splat"
                : tier == EffectTier.InnocentFruit ? "innocent_fruit"
                : tier == EffectTier.PeacefulCloud ? "peaceful_cloud" : "human_sparkle";
            int score = tier == EffectTier.SlopGrenade ? 88
                : tier == EffectTier.SlopSplat ? 68
                : tier == EffectTier.InnocentFruit ? 48
                : tier == EffectTier.PeacefulCloud ? 28 : 8;
            string subject = tier == EffectTier.SlopGrenade ? "Test Fire — Unedited AI Slop Grenade"
                : tier == EffectTier.SlopSplat ? "Test Fire — Heavy AI Template Cannon"
                : tier == EffectTier.InnocentFruit ? "Test Fire — Sprinkled AI Assist Fruit"
                : tier == EffectTier.PeacefulCloud ? "Test Fire — Lightly Polished Prose"
                : "Test Fire — Authentic Human Sparkle";
            return new EffectMessage
            {
                MessageId = "test-fire-" + seq,
                App = "outlook",
                Direction = side == Side.Left ? "received" : "sent",
                MonitorSide = side == Side.Left ? "left" : "right",
                Sender = side == Side.Left ? "Proving Grounds (Incoming Test)" : "You (Outgoing Test)",
                SubjectOrTopic = subject,
                Timestamp = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
                WordCount = 96,
                SlopScore = score,
                Tier = tierName,
                Breakdown = new EffectBreakdown
                {
                    LexicalScore = tier == EffectTier.SlopGrenade ? 36 : 12,
                    StructuralScore = tier == EffectTier.SlopGrenade ? 28 : 14,
                    BurstinessScore = 16,
                    HandoffScore = tier == EffectTier.SlopGrenade ? 8 : 0
                },
                RedactedPreview = "Synthetic test effect triggered from the desktop tray control panel. Real Outlook and Teams messages show their live sender, subject, and preview here.",
                Summary = "Desktop test fire preview."
            };
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
                psi.EnvironmentVariables["HTTP_BIND"] = ApiBase.Substring("http://".Length);
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
            Thread ledgerSyncThread = new Thread(LedgerSyncLoop);
            ledgerSyncThread.IsBackground = true;
            ledgerSyncThread.Start();

            while (_running)
            {
                try
                {
                    SyncLedgerReports();
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(ApiBase + "/api/v1/events/stream");
                    req.Method = "GET";
                    req.Timeout = Timeout.Infinite;
                    req.ReadWriteTimeout = Timeout.Infinite;
                    using (WebResponse resp = req.GetResponse())
                    using (Stream stream = resp.GetResponseStream())
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        _lastSeq = 0;
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

        private static void LedgerSyncLoop()
        {
            while (_running)
            {
                SyncGmailStatus();
                Thread.Sleep(5000);
                if (!_running) break;
                SyncLedgerReports();
            }
        }

        private static void SyncGmailStatus()
        {
            GmailStatus status = Dashboard.ReadGmailStatus();
            try
            {
                if (_running && _flyout != null && !_flyout.IsDisposed)
                    _flyout.BeginInvoke(new Action(delegate { _flyout.UpdateGmailStatus(status); }));
            }
            catch (InvalidOperationException) { }
        }

        private static void SyncLedgerReports()
        {
            long epoch;
            lock (_resetLock) epoch = _resetEpoch;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(ApiBase + "/api/v1/ledger");
                req.Method = "GET";
                req.Timeout = 3000;
                using (WebResponse resp = req.GetResponse())
                using (Stream stream = resp.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    QueueLedgerSnapshot(EffectNotice.ParseLedger(reader.ReadToEnd()), epoch);
                }
            }
            catch (Exception) { }
        }

        private static void QueueLedgerSnapshot(LedgerSnapshot snapshot, long epoch)
        {
            lock (_resetLock)
            {
                if (epoch != _resetEpoch || snapshot.ResetGeneration < _resetGeneration) return;
                bool reset = snapshot.ResetGeneration > _resetGeneration;
                if (reset)
                {
                    _resetGeneration = snapshot.ResetGeneration;
                    epoch = ++_resetEpoch;
                }
                QueueOverlayAction(epoch, delegate
                {
                    if (reset) ResetCommunicationState();
                    // Splats precede fruit so fruit can stick to freshly restored goop.
                    for (int pass = 0; pass < 2; pass++)
                        for (int i = snapshot.RecentReports.Length - 1; i >= 0; i--)
                        {
                            EffectMessage report = snapshot.RecentReports[i];
                            EffectTier tier = report.TierValue();
                            bool isSplat = tier == EffectTier.SlopGrenade || tier == EffectTier.SlopSplat;
                            if ((pass == 0) == isSplat) DispatchMessageReport(report, false);
                        }
                });
            }
        }

        private static void QueueOverlayAction(long epoch, Action action)
        {
            _overlay.BeginInvoke(new Action(delegate
            {
                lock (_resetLock)
                {
                    if (epoch != _resetEpoch) return;
                    action();
                }
            }));
        }

        private static void ResetCommunicationState()
        {
            _seenMessageIds.Clear();
            _activeDay = DateTime.Now.Date;
            _dailyRecAi = _dailyRecCount = _dailySentAi = _dailySentCount = 0;
            _localWipeAt[0] = _localWipeAt[1] = DateTime.MinValue;
            _overlay.Reset();
            RefreshDailyTrayMetrics();
        }

        private static void HandleSsePayload(string json)
        {
            try
            {
                EffectNotice notice = EffectNotice.Parse(json);
                lock (_resetLock)
                {
                    if (notice.DataWiped)
                    {
                        if (notice.ResetGeneration.GetValueOrDefault() > 0)
                        {
                            if (notice.ResetGeneration.Value <= _resetGeneration) return;
                            _resetGeneration = notice.ResetGeneration.Value;
                        }
                        else if (notice.Sequence <= _lastSeq) return;
                        _lastSeq = Math.Max(_lastSeq, notice.Sequence);
                        QueueOverlayAction(++_resetEpoch, ResetCommunicationState);
                        return;
                    }
                    if (notice.Sequence <= _lastSeq) return;
                    _lastSeq = notice.Sequence;
                    if (notice.ResetGeneration.HasValue && notice.ResetGeneration.Value < _resetGeneration) return;
                    bool reset = notice.ResetGeneration.GetValueOrDefault() > _resetGeneration;
                    if (reset)
                    {
                        _resetGeneration = notice.ResetGeneration.Value;
                        ++_resetEpoch;
                    }
                    QueueOverlayAction(_resetEpoch, delegate
                    {
                        if (reset) ResetCommunicationState();
                        if (notice.SqueegeeSide == "left" || notice.SqueegeeSide == "right")
                        {
                            Side side = notice.SqueegeeSide == "right" ? Side.Right : Side.Left;
                            if ((DateTime.UtcNow - _localWipeAt[side == Side.Left ? 0 : 1]).TotalMilliseconds >= 2500)
                                _overlay.Squeegee(side);
                        }
                        else DispatchMessageReport(notice.Report, true);
                    });
                }
            }
            catch (FormatException error) { DrawLog.Report("event metadata", error); }
            catch (InvalidOperationException)
            {
                if (_running) DrawLog.Report("event dispatch", new InvalidOperationException("The overlay could not dispatch an animation event."));
            }
        }

        private static void DispatchMessageReport(EffectMessage message, bool triggerTransient)
        {
            if (!_seenMessageIds.Add(message.MessageId)) return;
            string appStr = message.App;
            int score = message.SlopScore;
            // Automated mail (no-reply, calendar responses, bots) is not anyone's writing.
            bool automated = message.Summary.StartsWith("Automated / machine-generated response", StringComparison.Ordinal);
            EffectTier tier = message.TierValue();
            Side side = message.MonitorSide == "right" ? Side.Right : Side.Left;
            bool isSticky = tier == EffectTier.SlopGrenade || tier == EffectTier.SlopSplat || tier == EffectTier.InnocentFruit;

            if (!automated) RecordDailyMessageMetric(side, score);
            if (!triggerTransient && !isSticky) return;
            if (appStr == "teams" && !_settings.MonitorTeams) return;
            if (appStr == "outlook" && !_settings.MonitorOutlook) return;
            if (appStr == "gmail" && !_settings.MonitorGmail) return;
            bool isSlop = tier == EffectTier.SlopGrenade || tier == EffectTier.SlopSplat;
            if (isSlop && !_settings.SlopEffects) return;
            if (!isSlop && !_settings.CalmEffects) return;
            _overlay.Trigger(tier, side, message);
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
