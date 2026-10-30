using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

namespace SlopGrenadeDesktop
{
    internal static class EffectHoverTests
    {
        private static int _passed;

        [STAThread]
        private static void Main()
        {
            Run("ledger metadata and escaped JSON", Metadata);
            Run("invalid events never echo message data", InvalidEvents);
            Run("full reset removes ten queued grenades and scheduled metadata", ResetWorld);
            Run("grenade flight and impact keep the world at normal speed", NormalSpeed);
            Run("effects are smaller without changing grenade gravity", EffectSizes);
            Run("fly rendering is half its previous size", FlyArtworkSize);
            Run("mixed bursts respect the across-screen limit and drain", AnimationQueue);
            Run("cloud emission slots honor limits and release before smoke clears", PlumeSlots);
            Run("smoke uses half-resolution grid and remains visible", SmokeResolution);
            Run("parallel smoke compositing matches the GDI reference", SmokeRasterizerTests.MatchesGdi);
            Run("parallel smoke preserves clipped foreground layering", SmokeRasterizerTests.Layering);
            Run("real overlay displays parallel smoke and clears it on reset", SmokeOverlayIntegration);
            Run("queued fruit can wait for its prerequisite splat", QueueDependencies);
            Run("large grenade bursts queue every animation with attribution", QueueAttribution);
            Run("display rebuild preserves queued and scheduled effects", QueueDisplayRebuild);
            Run("wipe invalidates stale ledger responses and queued UI applies", ResetDispatch);
            Run("independent effects keep their own message", Attribution);
            Run("goop hit testing ignores transparent gaps and clears with a wipe", Goop);
            Run("grenades and cannon splats retain attribution", Splats);
            Run("detached drops keep their source", Descendants);
            Run("hover dwell, expiry and leaving an effect", Hover);
            Run("tooltip stays inside the working area", Placement);
            Run("details never activate or intercept clicks", WindowStyles);
            Run("real overlay hover works without focus or input capture", OverlayIntegration);
            Run("concurrent metadata logging stays bounded and deduplicated", Logging);
            Run("Gmail opens only the trusted loopback dashboard", GmailDesktopTests.TrustedDashboard);
            Run("Gmail status projects only sanitized local metadata", GmailDesktopTests.StatusProjection);
            Run("Gmail status stays loopback and rejects redirects", GmailDesktopTests.StatusTransport);
            Run("Gmail flyout action and status preserve existing controls", GmailDesktopTests.Flyout);
            Run("desktop shells never implement Gmail OAuth or token storage", GmailDesktopTests.ShellBoundary);
            Console.WriteLine("{0} desktop tests passed.", _passed);
        }

        private static void Run(string name, Action test)
        {
            test();
            _passed++;
            Console.WriteLine("PASS: " + name);
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void AnimationQueue()
        {
            using (World world = new World(400, 240, 60f, 19, 2))
            {
                RecordingSfx sfx = new RecordingSfx();
                world.Sfx = sfx;
                world.Trigger(EffectTier.SlopGrenade, Side.Left);
                world.Trigger(EffectTier.SlopSplat, Side.Right);
                world.Trigger(EffectTier.InnocentFruit, Side.Right);
                world.Trigger(EffectTier.PeacefulCloud, Side.Left);
                world.Trigger(EffectTier.HumanSparkle, Side.Right);
                Check(world.MaxAcrossScreenAnimations == Math.Min(2, Environment.ProcessorCount), "Limit must respect available logical processors.");
                for (int i = 0; i < 10; i++)
                {
                    world.Update(0.01f);
                    Check(world.ActiveAcrossScreenAnimations <= world.MaxAcrossScreenAnimations, "Mixed effects exceeded the limit.");
                }
                Check(sfx.Names.Contains("twinkle"), "Sparkles should not wait for an across-screen slot.");
                Check(!sfx.Names.Contains("whoosh") && !sfx.Names.Contains("smoke"), "Excess across-screen effects must wait.");
                for (int i = 0; i < 600 && (!sfx.Names.Contains("whoosh") || !sfx.Names.Contains("smoke")); i++)
                {
                    world.Update(0.05f);
                    Check(world.ActiveAcrossScreenAnimations <= world.MaxAcrossScreenAnimations, "Queued effects exceeded the limit.");
                }
                Check(sfx.Names.Contains("whoosh") && sfx.Names.Contains("smoke"), "Queued effects must eventually start.");
                world.Reset();
                Check(world.ActiveAcrossScreenAnimations == 0, "Reset must release all active slots.");
                world.Trigger(EffectTier.PeacefulCloud, Side.Left);
                world.Update(0.01f);
                Check(world.ActiveAcrossScreenAnimations == 1, "A new plume must start after reset.");
            }
        }

        private static void QueueAttribution()
        {
            using (World world = new World(400, 240, 60f, 23, 2))
            {
                RecordingSfx sfx = new RecordingSfx();
                world.Sfx = sfx;
                List<EffectMessage> messages = new List<EffectMessage>();
                for (int i = 0; i < 13; i++)
                {
                    EffectMessage message = Message("queued-" + i, "slop_grenade", "left");
                    messages.Add(message);
                    world.Trigger(EffectTier.SlopGrenade, Side.Left, message);
                }
                Check(world.Left.Splats.Count == 0, "Queued grenades must not become immediate splats.");
                HashSet<EffectMessage> launched = new HashSet<EffectMessage>();
                for (int i = 0; i < 1200 && launched.Count < messages.Count; i++)
                {
                    world.Update(0.05f);
                    Check(world.ActiveAcrossScreenAnimations <= world.MaxAcrossScreenAnimations, "Grenades exceeded the limit.");
                    foreach (Grenade grenade in world.Grenades) launched.Add(grenade.Message);
                }
                foreach (EffectMessage message in messages) Check(launched.Contains(message), "A queued grenade lost its attribution or never launched.");
                Check(sfx.Names.FindAll(delegate(string name) { return name == "throw"; }).Count == 13, "Each queued grenade must launch exactly once.");
            }
        }

        private static void PlumeSlots()
        {
            bool rejectedZero = false;
            try { using (World invalid = new World(400, 240, 60f, 27, 0)) { } }
            catch (ArgumentOutOfRangeException) { rejectedZero = true; }
            Check(rejectedZero, "A non-positive animation limit must be rejected.");
            foreach (int limit in new[] { 1, 2, 4 })
            {
                using (World world = new World(400, 240, 60f, 27, limit))
                {
                    RecordingSfx sfx = new RecordingSfx();
                    world.Sfx = sfx;
                    for (int i = 0; i < 4; i++) world.Trigger(EffectTier.PeacefulCloud, Side.Left);
                    for (int i = 0; i < 10; i++) world.Update(0.01f);
                    Check(world.ActiveAcrossScreenAnimations == Math.Min(limit, Environment.ProcessorCount),
                        "Cloud emission sequences must each occupy one slot.");
                    for (int i = 0; i < 500 &&
                        (sfx.Names.FindAll(delegate(string name) { return name == "smoke"; }).Count < 4 ||
                        world.ActiveAcrossScreenAnimations > 0); i++)
                    {
                        world.Update(0.05f);
                        Check(world.ActiveAcrossScreenAnimations <= world.MaxAcrossScreenAnimations, "Plumes exceeded the limit.");
                    }
                    Check(sfx.Names.FindAll(delegate(string name) { return name == "smoke"; }).Count == 4,
                        "Every queued plume must start.");
                    Check(world.ActiveAcrossScreenAnimations == 0 && !world.Smoke.IsEmpty,
                        "Plume slots must release when emission ends even while smoke remains.");
                }
            }
        }

        private static void SmokeResolution()
        {
            using (World world = new World(1920, 1080, 60f, 27))
            using (SmokeField previous = new SmokeField(1920, 1080, 90))
            {
                Check(world.Smoke.Ny * 2 == previous.Ny && world.Smoke.Nx * 2 == previous.Nx,
                    "Smoke grid dimensions must be halved.");
                Check(world.Smoke.Sprite.Width * 2 == previous.Sprite.Width &&
                    world.Smoke.Sprite.Height * 2 == previous.Sprite.Height, "Smoke sprite dimensions must be halved.");
                world.Trigger(EffectTier.PeacefulCloud, Side.Left);
                bool visible = false;
                for (int i = 0; i < 180; i++)
                {
                    world.Update(0.05f);
                    world.PrepareFrame();
                    if (world.Smoke.Bx1 >= world.Smoke.Bx0) visible = true;
                }
                Check(visible, "Reduced-resolution smoke must remain visible.");
            }
        }

        private static void QueueDependencies()
        {
            using (World world = new World(400, 240, 60f, 29, 1))
            {
                RecordingSfx sfx = new RecordingSfx();
                world.Sfx = sfx;
                world.Trigger(EffectTier.InnocentFruit, Side.Left);
                world.Trigger(EffectTier.SlopGrenade, Side.Left);
                for (int i = 0; i < 400 && !sfx.Names.Contains("whoosh"); i++) world.Update(0.05f);
                Check(sfx.Names.Contains("explosion") && sfx.Names.Contains("whoosh") &&
                    sfx.Names.IndexOf("explosion") < sfx.Names.IndexOf("whoosh"),
                    "A fruit waiting for a later splat must not deadlock the queue.");
            }
        }

        private static void QueueDisplayRebuild()
        {
            using (OverlayForm form = new OverlayForm(60f))
            {
                EffectMessage queued = Message("resize-queued", "slop_grenade", "left");
                EffectMessage scheduled = Message("resize-scheduled", "human_sparkle", "right");
                form.World.Trigger(EffectTier.SlopGrenade, Side.Left, queued);
                form.World.TriggerLater(1f, EffectTier.HumanSparkle, Side.Right, scheduled);
                for (int i = 0; i < 8; i++) form.World.Update(0.05f);
                form.World.Trigger(EffectTier.SlopGrenade, Side.Left, queued);
                MethodInfo rebuild = typeof(OverlayForm).GetMethod("BuildSurface", BindingFlags.Instance | BindingFlags.NonPublic);
                rebuild.Invoke(form, new object[] { form.Bounds });
                World world = form.World;
                world.Update(0.05f);
                Check(world.Grenades.Count == 1 && world.Grenades[0].Message == queued,
                    "A display rebuild must retain queued effects and their attribution.");
                for (int i = 0; i < 10; i++) world.Update(0.05f);
                Check(world.Twinkles.Count == 0, "A scheduled effect must retain its remaining delay.");
                for (int i = 0; i < 5; i++) world.Update(0.05f);
                Check(world.Twinkles.Count > 0 && world.Twinkles[0].Message == scheduled,
                    "A scheduled effect must survive display rebuild with its attribution.");
            }
        }

        private static string EventJson(string id, string tier, string side)
        {
            return new JavaScriptSerializer().Serialize(new
            {
                sequence = 42,
                report = new
                {
                    messageId = id, app = "outlook", direction = side == "left" ? "received" : "sent",
                    sender = "Fictional \"Avery\" \u2603",
                    subjectOrTopic = "Fictional subject\nwith a second line",
                    timestamp = "2026-10-26T10:15:30Z", wordCount = 42,
                    slopScore = 57, tier = tier, monitorSide = side,
                    breakdown = new { lexicalScore = 12.5, structuralScore = 8, burstinessScore = 6, handoffScore = 0 },
                    redactedPreview = "Synthetic preview only.",
                    summary = "Fictional scoring summary.",
                    body = "RAW BODY MUST NOT APPEAR IN DETAILS"
                }
            });
        }

        private static EffectMessage Message(string id, string tier, string side)
        {
            return EffectNotice.Parse(EventJson(id, tier, side)).Report;
        }

        private sealed class RecordingSfx : ISfxSink
        {
            public int Stops, Plays;
            public readonly List<string> Names = new List<string>();
            public readonly List<float> FuseRates = new List<float>();
            public void Play(string name, float pan, float gain, float rate) { Plays++; Names.Add(name); }
            public void Loop(string id, string name, float pan, float gain, float rate)
            {
                if (name == "fuse") FuseRates.Add(rate);
            }
            public void StopAll() { Stops++; Plays = 0; }
        }

        private static void NormalSpeed()
        {
            using (World world = new World(1920, 1080, 45f, 7))
            {
                RecordingSfx sfx = new RecordingSfx();
                world.Sfx = sfx;
                world.Trigger(EffectTier.SlopGrenade, Side.Left);
                world.Trigger(EffectTier.InnocentFruit, Side.Right);
                bool sawLateFlight = false, sawImpact = false;
                const float dt = 1f / 60f;
                for (int i = 0; i < 240; i++)
                {
                    float before = world.Now;
                    Grenade grenade = world.Grenades.Count > 0 ? world.Grenades[0] : null;
                    float grenadeAge = grenade == null ? 0f : grenade.Age;
                    Explosion explosion = world.Explosions.Count > 0 ? world.Explosions[0] : null;
                    float explosionAge = explosion == null ? 0f : explosion.Age;
                    world.Update(dt);
                    Check(Math.Abs(world.Now - before - dt) < 0.00001f, "Every frame must advance at normal speed, including after impact.");
                    if (grenade != null) Check(Math.Abs(grenade.Age - grenadeAge - dt) < 0.00001f, "Grenade flight must advance at normal speed.");
                    if (explosion != null) Check(Math.Abs(explosion.Age - explosionAge - dt) < 0.00001f, "Explosion must advance at normal speed after impact.");
                    foreach (Grenade g in world.Grenades) if (g.T > 0.8f) sawLateFlight = true;
                    if (sfx.Names.Contains("explosion")) sawImpact = true;
                }
                int left, right;
                world.SlopCounts(out left, out right);
                Check(sawLateFlight && sawImpact && left > 0 && right == 0, "The grenade must fly and splatter the correct edge.");
                Check(!sfx.Names.Contains("slowmo_in") && sfx.FuseRates.Count > 0, "Flight must not play slow-motion audio.");
                foreach (float rate in sfx.FuseRates) Check(rate == 1f, "Fuse audio must stay at normal speed.");
            }
        }

        private static void EffectSizes()
        {
            using (World world = new World(1920, 1080, 45f, 19))
            {
                Check(Math.Abs(world.S - 0.42f * 0.7f) < 0.000001f, "Effect artwork must be 30% smaller.");
                Check(Math.Abs(world.FlyDrawScale - 0.65f * 0.5f) < 0.000001f, "Fly artwork and redraw bounds must be 50% smaller.");
                world.Trigger(EffectTier.SlopGrenade, Side.Left);
                world.Trigger(EffectTier.HumanSparkle, Side.Right);
                world.Update(0.01f);
                world.Update(0.01f);
                Check(world.Grenades.Count == 1 && Math.Abs(world.Grenades[0].Gravity - 1500f * 0.42f) < 0.001f,
                    "Resizing must not slow the grenade's motion.");
                Check(world.Twinkles.Count > 0 && world.Twinkles[0].Size >= 26f * 0.7f &&
                    world.Twinkles[0].Size <= 34f * 0.7f, "Sparkles must also be 30% smaller.");
                Check(world.Particles.Items.Count > 0 && Math.Abs(world.Particles.Items[0].Gravity - 1600f * 0.42f) < 0.001f,
                    "Grenade parts must keep their original gravity.");
                world.Reset();
                world.Trigger(EffectTier.InnocentFruit, Side.Right);
                world.Update(0.01f);
                Check(world.Fruits.Count == 1 && Math.Abs(world.Fruits[0].Gravity - 1100f * 0.42f) < 0.001f,
                    "Resizing must not slow fruit gravity.");
                world.Reset();
                world.Trigger(EffectTier.SlopSplat, Side.Right);
                world.Update(0.01f);
                Check(world.Cannon.Count == 1, "The cannonball must launch.");
                float vy = world.Cannon[0].Vy;
                world.Update(0.01f);
                Check(Math.Abs(world.Cannon[0].Vy - vy - 1700f * 0.42f * 0.01f) < 0.001f,
                    "Resizing must not slow cannonball gravity.");
            }
        }

        private static Rectangle DrawnBounds(Bitmap bitmap)
        {
            int left = bitmap.Width, top = bitmap.Height, right = -1, bottom = -1;
            for (int y = 0; y < bitmap.Height; y++)
                for (int x = 0; x < bitmap.Width; x++)
                    if (bitmap.GetPixel(x, y).A != 0)
                    {
                        left = Math.Min(left, x); top = Math.Min(top, y);
                        right = Math.Max(right, x); bottom = Math.Max(bottom, y);
                    }
            return right < left ? Rectangle.Empty : Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
        }

        private static void FlyArtworkSize()
        {
            using (World world = new World(480, 2160, 45f, 19))
            using (Bitmap previous = new Bitmap(480, 240))
            using (Bitmap current = new Bitmap(480, 240))
            using (Graphics oldGraphics = Graphics.FromImage(previous))
            using (Graphics newGraphics = Graphics.FromImage(current))
            {
                world.Flies.Flies.Add(new Fly { X = 200f, Y = 100f, State = FlyState.Landed });
                oldGraphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                newGraphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                world.Flies.Draw(oldGraphics, world.UI * 0.65f);
                world.Render(newGraphics, new Rectangle(0, 0, current.Width, current.Height));
                Rectangle oldBounds = DrawnBounds(previous), newBounds = DrawnBounds(current);
                Check(!oldBounds.IsEmpty && !newBounds.IsEmpty &&
                    Math.Abs(newBounds.Width * 2 - oldBounds.Width) <= 3 &&
                    Math.Abs(newBounds.Height * 2 - oldBounds.Height) <= 3,
                    "Rendered fly dimensions must be half the previous size within pixel rounding.");
            }
        }

        private static void ResetWorld()
        {
            using (World world = new World(400, 240, 3f, 7))
            {
                RecordingSfx sfx = new RecordingSfx();
                world.Sfx = sfx;
                EffectMessage message = Message("forgotten", "slop_grenade", "left");
                foreach (EffectTier tier in new[] { EffectTier.SlopGrenade, EffectTier.SlopSplat,
                    EffectTier.InnocentFruit, EffectTier.PeacefulCloud, EffectTier.HumanSparkle })
                {
                    world.Trigger(tier, Side.Left, message);
                    world.Update(0.05f);
                }
                for (int i = 0; i < 10; i++) world.Trigger(EffectTier.SlopGrenade, Side.Left, message);
                world.TriggerLater(10f, EffectTier.SlopGrenade, Side.Right, message);
                world.Left.AddSplat(90, 1, world.Rng, 0, true, message);
                world.Right.AddSplat(120, 1, world.Rng, 0, true, message);
                world.SqueegeeSide(Side.Left);
                Check(world.Grenades.Count == 1 && world.HasHoverTargets && !world.IsIdle, "The reset fixture must include active and queued private effects.");
                world.Reset();
                Check(sfx.Stops == 1 && world.Sfx == sfx && world.Flies.Delay == 3f, "Reset must stop sounds without changing preferences.");
                Check(world.IsIdle && !world.HasHoverTargets && world.Smoke.IsEmpty,
                    "Reset must immediately clear active effects and private hover metadata.");
                int left, right;
                world.SlopCounts(out left, out right);
                Check(left == 0 && right == 0, "Both sides must immediately be empty.");
                for (int i = 0; i < 400; i++) world.Update(0.05f);
                world.SlopCounts(out left, out right);
                Check(world.IsIdle && left == 0 && right == 0 && sfx.Plays == 0,
                    "Pre-wipe queued or scheduled effects must never recreate old splats or sounds.");
                world.Trigger(EffectTier.HumanSparkle, Side.Right, Message("fresh", "human_sparkle", "right"));
                world.Update(0.05f);
                Check(world.Twinkles.Count > 0 && world.HasHoverTargets, "Later scans must still be able to populate the running world.");
            }
        }

        private static void ResetDispatch()
        {
            const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
            Type program = typeof(Program);
            string[] fields = { "_overlay", "_settings", "_lastSeq", "_resetEpoch", "_resetGeneration",
                "_dailyRecAi", "_dailyRecCount", "_dailySentAi", "_dailySentCount", "_restartAllowed", "_resetPending" };
            object[] saved = new object[fields.Length];
            for (int i = 0; i < fields.Length; i++) saved[i] = program.GetField(fields[i], flags).GetValue(null);
            System.Collections.Generic.HashSet<string> seen = (System.Collections.Generic.HashSet<string>)
                program.GetField("_seenMessageIds", flags).GetValue(null);
            MethodInfo queue = program.GetMethod("QueueLedgerSnapshot", flags);
            MethodInfo receive = program.GetMethod("HandleSsePayload", flags);
            using (OverlayForm overlay = new OverlayForm(60))
            {
                try
                {
                    overlay.Show();
                    program.GetField("_overlay", flags).SetValue(null, overlay);
                    Settings settings = new Settings();
                    program.GetField("_settings", flags).SetValue(null, settings);
                    foreach (string field in new[] { "_lastSeq", "_resetEpoch", "_resetGeneration" })
                        program.GetField(field, flags).SetValue(null, 0L);
                    program.GetField("_restartAllowed", flags).SetValue(null, false);
                    program.GetField("_resetPending", flags).SetValue(null, false);
                    seen.Clear();
                    EffectMessage stale = Message("stale", "slop_grenade", "left");
                    // This represents a completed HTTP read whose UI callback has not run yet.
                    queue.Invoke(null, new object[] { new LedgerSnapshot { RecentReports = new[] { stale } }, 0L });
                    receive.Invoke(null, new object[] { "{\"sequence\":1,\"dataWiped\":true,\"resetGeneration\":2}" });
                    // This represents a slower HTTP response issued before the wipe.
                    queue.Invoke(null, new object[] { new LedgerSnapshot { RecentReports = new[] { stale } }, 0L });
                    receive.Invoke(null, new object[] { EventJson("stale-event", "slop_grenade", "left")
                        .Replace("\"sequence\":42", "\"resetGeneration\":1,\"sequence\":2") });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Count == 0 && !overlay.World.HasHoverTargets && overlay.World.Squeegees.Count == 0,
                        "A wipe must invalidate pending UI callbacks and stale responses without spawning squeegees.");
                    Check((int)program.GetField("_dailyRecCount", flags).GetValue(null) == 0,
                        "Stale callbacks must not restore tray metrics.");
                    queue.Invoke(null, new object[] { new LedgerSnapshot { ResetGeneration = 2,
                        RecentReports = new[] { Message("fresh", "slop_splat", "right") } }, 1L });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Contains("fresh") && seen.Count == 1 && overlay.World.HasHoverTargets,
                        "A post-wipe snapshot must populate only fresh metadata.");
                    receive.Invoke(null, new object[] { "{\"sequence\":3,\"dataWiped\":true,\"resetGeneration\":2}" });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Contains("fresh"), "A duplicate durable marker must not erase a later scan.");
                    queue.Invoke(null, new object[] { new LedgerSnapshot { ResetGeneration = 3,
                        RecentReports = new EffectMessage[0] }, 1L });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Count == 0 && !overlay.World.HasHoverTargets,
                        "A newer snapshot must reconcile a missed SSE wipe.");
                    program.GetMethod("RestartOverlaySession", flags).Invoke(null, null);
                    queue.Invoke(null, new object[] { new LedgerSnapshot { ResetGeneration = 3,
                        RecentReports = new[] { stale } }, 2L });
                    queue.Invoke(null, new object[] { new LedgerSnapshot { ResetGeneration = 0,
                        RecentReports = new[] { Message("new-daemon", "slop_splat", "right") } }, 3L });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Count == 1 && seen.Contains("new-daemon"),
                        "A restarted daemon may repopulate at generation zero, but old in-flight responses must remain invalid.");
                    program.GetMethod("RestartOverlaySession", flags).Invoke(null, null);
                    long currentEpoch = (long)program.GetField("_resetEpoch", flags).GetValue(null);
                    queue.Invoke(null, new object[] { new LedgerSnapshot { ResetGeneration = 0,
                        RecentReports = new[] { Message("same-daemon", "slop_splat", "right") } }, currentEpoch });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Count == 2 && seen.Contains("new-daemon") && seen.Contains("same-daemon"),
                        "A same-generation reconnect must not erase later scans.");
                    receive.Invoke(null, new object[] { "{\"sequence\":1,\"dataWiped\":true,\"resetGeneration\":1}" });
                    // Reconnect before the queued wipe callback executes.
                    program.GetMethod("RestartOverlaySession", flags).Invoke(null, null);
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Count == 0 && !overlay.World.HasHoverTargets,
                        "A pending wipe must still clear immediately on reconnect, even before a fresh HTTP response.");
                    currentEpoch = (long)program.GetField("_resetEpoch", flags).GetValue(null);
                    queue.Invoke(null, new object[] { new LedgerSnapshot { ResetGeneration = 1,
                        RecentReports = new EffectMessage[0] }, currentEpoch });
                    System.Windows.Forms.Application.DoEvents();
                    Check(seen.Count == 0 && !overlay.World.HasHoverTargets,
                        "A reconnect must not cancel an unapplied wipe merely because the refreshed snapshot has the same generation.");
                    Check(settings.MonitorTeams && settings.MonitorOutlook && settings.MonitorGmail,
                        "Reset must preserve all source preferences.");
                }
                finally
                {
                    seen.Clear();
                    for (int i = 0; i < fields.Length; i++) program.GetField(fields[i], flags).SetValue(null, saved[i]);
                }
            }
        }

        private static void Metadata()
        {
            EffectNotice notice = EffectNotice.Parse(EventJson("fixture-1", "innocent_fruit", "left"));
            Check(notice.Sequence == 42 && notice.Report.MessageId == "fixture-1", "Correlation was lost.");
            Check(notice.Report.Sender == "Fictional \"Avery\" \u2603", "JSON escapes must decode correctly.");
            string text = notice.Report.DetailsText();
            foreach (string value in new[] { "57%", "sprinkled", "Outlook", "Incoming", "From:", "To: You", "42 words", "12.5", "Subject:", "Synthetic preview only." })
                Check(text.Contains(value), "Missing ledger detail: " + value);
            Check(text.Contains(DateTimeOffset.Parse("2026-10-26T10:15:30Z").ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")), "Timestamp must be local and include seconds.");
            Check(!text.Contains("RAW BODY"), "Unknown raw fields must never be shown.");
            Check(!notice.Report.SubjectOrTopic.Contains("\n"), "Untrusted fields must not inject detail rows.");
            EffectMessage outgoing = Message("fixture-sent", "slop_splat", "right");
            Check(outgoing.DetailsText().Contains("To: Team / Recipient"), "Outgoing labels must match the ledger.");
            EffectNotice wipe = EffectNotice.Parse("{\"sequence\":43,\"squeegeeSide\":\"left\"}");
            Check(wipe.SqueegeeSide == "left" && wipe.Report == null, "Wipes must keep their existing contract.");
            EffectNotice dataWipe = EffectNotice.Parse("{\"sequence\":44,\"dataWiped\":true}");
            Check(dataWipe.DataWiped && dataWipe.Report == null, "Data wipes must not require communication metadata.");
            Check(!dataWipe.ResetGeneration.HasValue && EffectNotice.ParseLedger("{\"recentReports\":[]}").ResetGeneration == 0,
                "Older responders must remain compatible with optional reset metadata.");
            Check(EffectNotice.Parse("{\"sequence\":45,\"dataWiped\":true,\"resetGeneration\":7}").ResetGeneration == 7
                && EffectNotice.ParseLedger("{\"resetGeneration\":7,\"recentReports\":[]}").ResetGeneration == 7,
                "Durable remote reset generations must survive parsing.");
        }

        private static void InvalidEvents()
        {
            foreach (string input in new[] {
                "private-fixture-invalid-json",
                "{\"sequence\":1}",
                EventJson("fixture-bad-time", "innocent_fruit", "left").Replace("2026-10-26T10:15:30Z", "private-fixture-invalid-time"),
                EventJson("fixture-bad-tier", "private-fixture-invalid-tier", "left")
            })
            {
                try { EffectNotice.Parse(input); throw new InvalidOperationException("Invalid event was accepted."); }
                catch (FormatException error) { Check(!error.ToString().Contains("private-fixture"), "Parser errors leaked provider input."); }
            }
        }

        private static void Attribution()
        {
            using (World world = new World(800, 600, 60f, 7))
            {
                EffectMessage first = Message("first", "innocent_fruit", "left");
                EffectMessage second = Message("second", "innocent_fruit", "right");
                world.Trigger(EffectTier.InnocentFruit, Side.Left, first);
                world.Update(0.01f);
                world.Trigger(EffectTier.InnocentFruit, Side.Right, second);
                for (int i = 0; i < 10; i++) world.Update(0.05f);
                Check(world.Fruits.Count == 2, "Both queued fruits must be present.");
                Fruit a = world.Fruits[0], b = world.Fruits[1];
                a.X = 150; a.Y = 200; b.X = 600; b.Y = 200;
                a.State = b.State = FruitState.Stuck;
                a.Sprite = new PixelSprite(4, 4); b.Sprite = new PixelSprite(4, 4);
                for (int i = 0; i < 16; i++) { a.Sprite.Pixels[i] = -1; b.Sprite.Pixels[i] = -1; }
                Check(world.MessageAt(150, 200) == first && world.MessageAt(600, 200) == second, "Fruit attribution crossed messages or sides.");
                Check(world.MessageAt(154, 204) == null, "Transparent sprite margins must not be hover targets.");
                a.Message = null;
                Check(world.MessageAt(150, 200) == null, "Test effects must never borrow a real message.");
                a.State = FruitState.Gone;
                Check(world.MessageAt(150, 200) == null, "Removed effects must not retain hover targets.");
            }
        }

        private static Point OpaquePoint(SlopLayer layer, int minY, int maxY)
        {
            for (int y = minY; y < maxY; y++)
                for (int x = 0; x < layer.StripW; x++)
                    if ((uint)layer.Sprite.Pixels[y * layer.StripW + x] >> 24 > 200 && layer.MessageAt(layer.StripX + x, y) != null)
                        return new Point(layer.StripX + x, y);
            throw new InvalidOperationException("No attributed opaque goop pixel found.");
        }

        private static void Goop()
        {
            using (World world = new World(800, 600, 60f, 11))
            {
                EffectMessage first = Message("goop-first", "slop_grenade", "left");
                EffectMessage second = Message("goop-second", "slop_splat", "left");
                world.Left.AddSplat(150, 1, world.Rng, 0, true, first);
                world.Left.AddSplat(450, 0.62f, world.Rng, 0, false, second);
                world.Left.Update(1);
                world.Left.Flush(10000);
                Point a = OpaquePoint(world.Left, 125, 175), b = OpaquePoint(world.Left, 440, 460);
                Check(world.MessageAt(a.X, a.Y) == first && world.MessageAt(b.X, b.Y) == second, "Separate splats must show their own messages.");
                world.Left.AddSplat(150, 1, world.Rng, 0, true, null);
                world.Left.Flush(10000);
                Check(world.MessageAt(a.X, a.Y) == first, "Unattributed splats must not shadow attributed splats.");
                Check(world.MessageAt(400, 300) == null, "Empty screen must never show message details.");
                world.Left.Clear(); world.Left.Flush(10000);
                Check(world.MessageAt(a.X, a.Y) == null && !world.HasHoverTargets, "A wipe must remove its hover metadata.");
                world.TriggerLater(0.2f, EffectTier.SlopGrenade, Side.Right, second);
                Check(world.HasHoverTargets, "Scheduled effects with metadata must keep hover tracking active.");
            }
        }

        private static void Splats()
        {
            foreach (EffectTier tier in new[] { EffectTier.SlopGrenade, EffectTier.SlopSplat })
            {
                using (World world = new World(800, 600, 60f, 17))
                {
                    EffectMessage message = Message("impact", tier == EffectTier.SlopGrenade ? "slop_grenade" : "slop_splat", "left");
                    world.Trigger(tier, Side.Left, message);
                    for (int i = 0; i < 200 && world.Left.Splats.Count == 0; i++) world.Update(0.05f);
                    Check(world.Left.Splats.Count > 0, "The projectile never splatted.");
                    world.Left.Update(1); world.Left.Flush(10000);
                    Point point = OpaquePoint(world.Left, 0, 600);
                    Check(world.Left.MessageAt(point.X, point.Y) == message, "Impact lost the source message.");
                    foreach (GooBlob blob in world.Left.Blobs) Check(blob.Message == message, "A child glob lost attribution.");
                    foreach (Drip drip in world.Left.Drips) Check(drip.Message == message, "A child drip lost attribution.");
                }
            }
        }

        private static void Hover()
        {
            EffectHoverTracker hover = new EffectHoverTracker();
            EffectMessage message = Message("hover", "innocent_fruit", "left");
            Point point = new Point(10, 200);
            Check(hover.Update(message, point, 0) == null, "Hover must not open immediately.");
            Check(hover.Update(message, point, 499) == null, "Hover dwell was too short.");
            Check(hover.Update(message, point, 500) == message, "Hover did not open after its dwell.");
            Check(hover.Update(message, point, 10501) == null, "Private details must not remain indefinitely.");
            Check(hover.Update(message, new Point(25, 200), 10600) == null, "Moving after expiry must restart dwell on the same blob.");
            Check(hover.Update(message, new Point(25, 200), 11100) == message, "Moving after expiry must re-open details after dwell.");
            Check(hover.Update(null, point, 11200) == null, "Leaving the effect must hide details.");
            Check(hover.Update(message, point, 12000) == null, "Re-entering must wait again.");
            Check(hover.Update(message, new Point(40, 200), 12400) == null, "Moving over an effect must restart dwell.");
            Check(hover.Update(message, new Point(40, 200), 12900) == message, "A deliberate second hover must work.");
            Check(hover.Update(Message("other", "innocent_fruit", "left"), point, 12901) == null, "Another message must not inherit the previous dwell.");
        }

        private static void Descendants()
        {
            using (World world = new World(800, 600, 60f, 19))
            {
                EffectMessage message = Message("impact-drop", "slop_grenade", "left");
                world.Trigger(EffectTier.SlopGrenade, Side.Left, message);
                for (int i = 0; i < 200 && world.Left.Splats.Count == 0; i++) world.Update(0.05f);
                Check(world.Left.Splats.Count == 1, "The grenade must create an attributed splat.");
                world.Left.Update(1); world.Left.Flush(10000);
                Point point = OpaquePoint(world.Left, 0, 600);
                Check(world.Left.MessageAt(point.X, point.Y) == message, "Impact splats lost their metadata.");
                Drip drip = world.Left.Drips[0];
                drip.MaxLen = 1; drip.Len = 0.99f; drip.Speed = 100;
                world.Left.Update(0.1f);
                Check(world.Left.Drops.Count > 0, "The fixture drip never detached.");
                foreach (GooDrop drop in world.Left.Drops) Check(drop.Message == message, "Detached drops lost their source.");
            }
        }

        private static void Placement()
        {
            foreach (Rectangle screen in new[] { new Rectangle(0, 0, 800, 600), new Rectangle(-900, -200, 800, 600), new Rectangle(0, 0, 240, 180) })
                foreach (Point point in new[] { screen.Location, new Point(screen.Right - 1, screen.Bottom - 1) })
                {
                    Rectangle bounds = EffectDetailsForm.Place(point, new Size(420, 260), screen);
                    Check(screen.Contains(bounds), "Details must be clamped to the screen working area.");
                    Check(!bounds.Contains(point), "Details should not cover the hovered item.");
                }
        }

        private static void WindowStyles()
        {
            using (EffectDetailsForm details = new EffectDetailsForm())
            {
                PropertyInfo property = typeof(EffectDetailsForm).GetProperty("CreateParams", BindingFlags.Instance | BindingFlags.NonPublic);
                System.Windows.Forms.CreateParams parameters = (System.Windows.Forms.CreateParams)property.GetValue(details, null);
                int required = NativeMethods.WS_EX_TRANSPARENT | NativeMethods.WS_EX_NOACTIVATE | NativeMethods.WS_EX_LAYERED;
                Check((parameters.ExStyle & required) == required, "Tooltip must remain layered, click-through and non-activating.");
                Check(!details.ShowInTaskbar, "Hover details must not create a taskbar entry.");
            }
        }

        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        private static extern int GetWindowLong(IntPtr window, int index);

        [DllImport("user32.dll")]
        private static extern IntPtr WindowFromPoint(Point point);

        private static bool PumpUntil(Func<bool> ready, int milliseconds)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (!ready() && DateTime.UtcNow < until)
            {
                System.Windows.Forms.Application.DoEvents();
                Thread.Sleep(10);
            }
            return ready();
        }

        private static void OverlayIntegration()
        {
            Point cursor = Point.Empty;
            using (OverlayForm overlay = new OverlayForm(60, delegate { return cursor; }))
            {
                overlay.Show();
                EffectMessage message = Message("hover-integration", "innocent_fruit", "left");
                Fruit fruit = new Fruit(0, Side.Left, overlay.World.W, overlay.World.H, overlay.World.S, overlay.World.MotionScale, overlay.World.Rng, 200);
                fruit.X = 200; fruit.Y = 200; fruit.State = FruitState.Stuck;
                fruit.RenderedAngle = fruit.Angle;
                fruit.Sprite = new PixelSprite(4, 4);
                for (int i = 0; i < 16; i++) fruit.Sprite.Pixels[i] = -1;
                fruit.Message = message;
                overlay.World.Fruits.Add(fruit);
                overlay.Trigger(EffectTier.PeacefulCloud, Side.Left, message);
                cursor = new Point(overlay.Left + 200, overlay.Top + 200);
                EffectDetailsForm details = (EffectDetailsForm)typeof(OverlayForm)
                    .GetField("_details", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(overlay);
                Check(PumpUntil(delegate { return details.Visible; }, 5000) && details.AccessibleDescription == message.DetailsText(),
                    "The real hover timer did not show the ledger metadata.");
                int required = NativeMethods.WS_EX_NOACTIVATE | NativeMethods.WS_EX_TRANSPARENT | NativeMethods.WS_EX_LAYERED;
                Check((GetWindowLong(details.Handle, -20) & required) == required, "The real details window must not activate or capture input.");
                IntPtr hit = WindowFromPoint(cursor);
                Check(hit != overlay.Handle && hit != details.Handle, "The desktop overlay must pass mouse input through.");
                cursor = new Point(overlay.Left + 400, overlay.Top + 300);
                Check(PumpUntil(delegate { return !details.Visible; }, 2000) && details.AccessibleDescription.Length == 0,
                    "Leaving must hide and clear private details.");
                cursor = new Point(overlay.Left + 200, overlay.Top + 200);
                Check(PumpUntil(delegate { return details.Visible; }, 5000), "Returning must show the details again.");
                overlay.Reset();
                Check(!details.Visible && details.AccessibleDescription.Length == 0 && !overlay.World.HasHoverTargets,
                    "A full reset must synchronously hide and forget the hover popup without moving the cursor.");
            }
        }

        private static void SmokeOverlayIntegration()
        {
            foreach (bool optimized in new[] { true, false })
            using (OverlayForm overlay = new OverlayForm(60, null, optimized))
            {
                overlay.Show();
                int x = overlay.World.W / 2, y = overlay.World.H / 2;
                overlay.World.Smoke.Puff(x, y, overlay.World.H * 0.1f, 4f, 0f, 0f, 0.3f);
                overlay.Trigger(EffectTier.HumanSparkle, Side.Left);
                FieldInfo rasterField = typeof(OverlayForm).GetField("_smokeRasterizer", BindingFlags.Instance | BindingFlags.NonPublic);
                Check(rasterField != null, "The overlay must use the smoke rasterizer.");
                Bitmap surface = (Bitmap)typeof(OverlayForm).GetField("_surface", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(overlay);
                Check(PumpUntil(delegate
                {
                    SmokeRasterizer raster = (SmokeRasterizer)rasterField.GetValue(overlay);
                    return raster.Ready == optimized && surface.GetPixel(x, y).A > 0;
                }, 5000), "Prepared smoke must appear in the actual overlay surface.");
                overlay.Reset();
                Check(surface.GetPixel(x, y).A == 0, "Reset must not redraw cached smoke.");
                if (optimized)
                {
                    SmokeRasterizer raster = (SmokeRasterizer)rasterField.GetValue(overlay);
                    Check(typeof(SmokeRasterizer).GetField("_pixels", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(raster) == null,
                        "Reset must release the cached smoke buffer.");
                }
            }
        }

        private static void Logging()
        {
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "slop-grenade-log-test-" + Guid.NewGuid() + ".log");
            FieldInfo field = typeof(DrawLog).GetField("_path", BindingFlags.Static | BindingFlags.NonPublic);
            object original = field.GetValue(null);
            try
            {
                field.SetValue(null, path);
                Thread[] threads = new Thread[8];
                for (int i = 0; i < threads.Length; i++)
                {
                    threads[i] = new Thread(delegate()
                    {
                        for (int j = 0; j < 100; j++)
                            DrawLog.Report("synthetic event metadata", new FormatException("Invalid animation metadata."));
                    });
                    threads[i].Start();
                }
                foreach (Thread thread in threads) thread.Join();
                string text = File.ReadAllText(path);
                Check(text.Split(new[] { "[synthetic event metadata]" }, StringSplitOptions.None).Length == 2,
                    "Concurrent failures must be logged exactly once.");
            }
            finally
            {
                field.SetValue(null, original);
                if (File.Exists(path)) File.Delete(path);
            }
        }
    }
}
