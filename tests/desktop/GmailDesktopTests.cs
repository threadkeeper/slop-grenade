using System;
using System.Collections;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace SlopGrenadeDesktop
{
    internal static class GmailDesktopTests
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        public static void TrustedDashboard()
        {
            CheckDashboard(null, 8090);
            CheckDashboard("", 8090);
            CheckDashboard("127.0.0.1:8090", 8090);
            CheckDashboard("127.0.0.1:18443", 18443);
            CheckDashboard("127.0.0.1:1", 1);
            CheckDashboard("127.0.0.1:65535", 65535);
            foreach (string bind in new[] {
                "0.0.0.0:9000", "localhost:9000", "example.invalid:9000", "https://example.invalid",
                "127.0.0.1:9000@example.invalid", "127.0.0.1:9000/?gmail=other",
                "127.0.0.1:9000\\@example.invalid", "127.0.0.1:9000#fragment",
                "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:-1", "127.0.0.1:+9000",
                "127.0.0.1: 9000", "127.0.0.1:9000\r\n", "127.0.0.1:999999999999999"
            })
                CheckDashboard(bind, 8090);
        }

        private static void CheckDashboard(string bind, int port)
        {
            LocalDashboard dashboard = new LocalDashboard(bind);
            string opened = null;
            int calls = 0;
            dashboard.OpenGmail(delegate(string url) { opened = url; calls++; });
            Check(calls == 1, "Gmail must launch exactly one browser action.");
            Check(opened == "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/?gmail=signin",
                "Gmail must open only the fixed dashboard intent on the trusted daemon port.");
            Uri uri = new Uri(opened);
            Check(uri.IsLoopback && uri.Scheme == "http" && uri.Host == "127.0.0.1"
                && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Fragment.Length == 0,
                "Dashboard launch must not accept a provider URL, credentials, or callback.");
        }

        private static string StatusFixture()
        {
            return new JavaScriptSerializer().Serialize(new
            {
                workiq = new { connected = true, privateField = "fixture-workiq-secret" },
                githubLuna = new { connected = true, privateField = "fixture-luna-secret" },
                gmail = new
                {
                    enabled = true, configured = true,
                    accounts = new[] {
                        new {
                            id = "synthetic-hashed-id-a", label = "fixture-private-account-label",
                            connected = true, reconnectRequired = false,
                            lastSuccessfulScan = "2026-10-27T10:15:00Z",
                            error = "", access_token = "fixture-access-secret", refresh_token = "fixture-refresh-secret"
                        },
                        new {
                            id = "synthetic-hashed-id-b", label = "fixture-private-account-label-b",
                            connected = false, reconnectRequired = true,
                            lastSuccessfulScan = "2026-10-26T09:00:00Z",
                            error = "fixture-provider-error-with-private-data",
                            access_token = "fixture-access-secret-b", refresh_token = "fixture-refresh-secret-b"
                        }
                    }
                }
            });
        }

        public static void StatusProjection()
        {
            GmailStatus status = GmailStatus.FromAuthJson(StatusFixture());
            Check(status.Summary == "Gmail: 1/2 connected; 1 reconnect required", "Account and reconnect states were lost.");
            string localScan = DateTimeOffset.Parse("2026-10-27T10:15:00Z", CultureInfo.InvariantCulture)
                .ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
            Check(status.Details.Contains(localScan) && status.Details.Contains("temporary error"), "Last scan or transient error state was lost.");
            string projected = new JavaScriptSerializer().Serialize(status);
            foreach (string forbidden in new[] { "fixture-", "synthetic-hashed", "access_token", "refresh_token", "label", "workiq", "githubLuna" })
                Check(!projected.Contains(forbidden), "Status must retain only counts, timestamps and fixed messages.");

            Check(GmailStatus.FromAuthJson("{\"gmail\":{\"enabled\":false,\"configured\":false}}").Summary == "Gmail: disabled", "Disabled state was lost.");
            Check(GmailStatus.FromAuthJson("{\"gmail\":{\"enabled\":true,\"configured\":false}}").Summary == "Gmail: setup required", "Configuration state was lost.");
            status = GmailStatus.FromAuthJson("{\"gmail\":{\"enabled\":true,\"configured\":true,\"accounts\":[]}}");
            Check(status.Summary == "Gmail: disconnected" && status.Details.Contains("daemon restart"), "Restart must require explicit reconnection.");
            status = GmailStatus.FromAuthJson("{\"gmail\":{\"enabled\":true,\"configured\":true,\"accounts\":[{\"connected\":false,\"reconnectRequired\":false,\"lastSuccessfulScan\":null}]}}");
            Check(status.Summary == "Gmail: 0/1 connected" && status.Details == "No successful scan", "Disconnected account state was lost.");
            status = GmailStatus.FromAuthJson(StatusFixture().Replace("2026-10-27T10:15:00Z", "fixture-invalid-timestamp")
                .Replace("2026-10-26T09:00:00Z", "fixture-invalid-timestamp"));
            Check(status.Details.StartsWith("No successful scan", StringComparison.Ordinal), "Invalid timestamps must never be shown verbatim.");
            foreach (string invalid in new[] {
                null, "", "fixture-invalid-json", "{}", "{\"workiq\":{},\"githubLuna\":{}}",
                "{\"gmail\":null}", "{\"gmail\":{\"enabled\":\"true\",\"configured\":true}}",
                "{\"gmail\":{\"enabled\":true,\"configured\":true,\"accounts\":{}}}",
                "{\"gmail\":{\"enabled\":true,\"configured\":true,\"accounts\":[{}]}}",
                new string('x', GmailStatus.MaxStatusLength + 1)
            })
                Check(GmailStatus.FromAuthJson(invalid) == GmailStatus.Unavailable, "Missing, malformed or oversized status must fail closed.");
        }

        public static void StatusTransport()
        {
            string headers;
            string body = StatusFixture();
            GmailStatus status = ServeStatus("200 OK", "", body, out headers);
            Check(status.Summary == "Gmail: 1/2 connected; 1 reconnect required", "The combined local auth endpoint was not consumed.");
            Check(headers.StartsWith("GET /api/v1/auth/status HTTP/1.1\r\n", StringComparison.Ordinal),
                "The shell must request only sanitized combined auth status, not Gmail or OAuth APIs.");
            Check(headers.IndexOf("Authorization:", StringComparison.OrdinalIgnoreCase) < 0
                && headers.IndexOf("Cookie:", StringComparison.OrdinalIgnoreCase) < 0,
                "The shell must never send OAuth credentials.");
            status = ServeStatus("302 Found", "Location: https://example.invalid/oauth\r\n", "", out headers);
            Check(status == GmailStatus.Unavailable, "Local status requests must never follow provider redirects.");
            status = ServeStatus("500 Internal Server Error", "", "fixture-private-server-error", out headers);
            Check(status == GmailStatus.Unavailable, "HTTP failures must not expose response bodies.");
            status = ServeStatus("200 OK", "", new string('x', GmailStatus.MaxStatusLength + 1), out headers);
            Check(status == GmailStatus.Unavailable, "Local status reads must be bounded.");
        }

        private static GmailStatus ServeStatus(string code, string extraHeaders, string body, out string headers)
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            string received = "";
            Exception failure = null;
            Thread server = new Thread(delegate()
            {
                try
                {
                    using (TcpClient client = listener.AcceptTcpClient())
                    {
                        client.ReceiveTimeout = 4000;
                        client.SendTimeout = 4000;
                        using (NetworkStream stream = client.GetStream())
                        {
                            StreamReader reader = new StreamReader(stream, Encoding.ASCII);
                            string line;
                            while (!string.IsNullOrEmpty(line = reader.ReadLine())) received += line + "\r\n";
                            byte[] bytes = Encoding.UTF8.GetBytes(body);
                            byte[] head = Encoding.ASCII.GetBytes("HTTP/1.1 " + code + "\r\n" + extraHeaders
                                + "Content-Type: application/json\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n");
                            stream.Write(head, 0, head.Length);
                            stream.Write(bytes, 0, bytes.Length);
                        }
                    }
                }
                catch (Exception error) { failure = error; }
            });
            server.IsBackground = true;
            server.Start();
            try
            {
                int port = ((IPEndPoint)listener.LocalEndpoint).Port;
                GmailStatus status = new LocalDashboard("127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture)).ReadGmailStatus();
                Check(server.Join(5000), "Synthetic status server did not finish.");
                Check(failure == null, "Synthetic status transport failed.");
                headers = received;
                return status;
            }
            finally
            {
                listener.Stop();
                server.Join(5000);
            }
        }

        public static void Flyout()
        {
            string command = null;
            Settings settings = new Settings();
            using (TrayFlyout flyout = new TrayFlyout(settings, delegate { return false; }, delegate(bool enabled) { }, delegate(string id) { command = id; }))
            using (Bitmap image = new Bitmap(flyout.Width, flyout.Height))
            using (Graphics graphics = Graphics.FromImage(image))
            {
                flyout.UpdateGmailStatus(GmailStatus.FromAuthJson(StatusFixture()));
                Check(flyout.AccessibleDescription.Contains("1/2 connected") && !flyout.AccessibleDescription.Contains("fixture-"),
                    "The flyout must show only sanitized local Gmail state.");
                typeof(TrayFlyout).GetMethod("OnPaint", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(flyout, new object[] { new PaintEventArgs(graphics, flyout.ClientRectangle) });
                IEnumerable hits = (IEnumerable)typeof(TrayFlyout).GetField("_hits", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(flyout);
                System.Collections.Generic.Dictionary<string, RectangleF> buttons = new System.Collections.Generic.Dictionary<string, RectangleF>();
                foreach (object hit in hits)
                {
                    string id = (string)hit.GetType().GetField("Id").GetValue(hit);
                    RectangleF rect = (RectangleF)hit.GetType().GetField("Rect").GetValue(hit);
                    Check(flyout.ClientRectangle.Contains(Rectangle.Ceiling(rect)), "Flyout controls must remain inside the expanded panel.");
                    buttons.Add(id, rect);
                }
                foreach (string id in new[] { "startup", "teams", "outlook", "gmail", "slopfx", "calmfx", "sound", "vol35", "vol70", "vol100" })
                    Check(buttons.ContainsKey(id), "Existing tray preferences must remain available.");
                foreach (string id in new[] { "m365-signin", "m365-signout", "gmail-signin", "gmail-signout", "dashboard", "test", "quit", "squeegee-left", "squeegee-right" })
                {
                    RectangleF rect = buttons[id];
                    MouseEventArgs click = new MouseEventArgs(MouseButtons.Left, 1, (int)(rect.X + rect.Width / 2), (int)(rect.Y + rect.Height / 2), 0);
                    typeof(TrayFlyout).GetMethod("OnMouseDown", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(flyout, new object[] { click });
                    typeof(TrayFlyout).GetMethod("OnMouseUp", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(flyout, new object[] { click });
                    Check(command == id, "The flyout must dispatch Gmail and existing commands independently.");
                }
                Check(settings.MonitorOutlook && settings.MonitorTeams && settings.MonitorGmail, "Account actions must not modify source preferences.");
                flyout.UpdateGmailStatus(null);
                Check(flyout.AccessibleDescription.Contains("unavailable"), "A failed refresh must clear stale account status.");
            }
        }

        public static void ShellBoundary()
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"..\.."));
            string program = File.ReadAllText(Path.Combine(root, @"desktop\Program.cs"));
            foreach (string entry in new[] {
                "Sign in to Microsoft 365", "Sign out of Microsoft 365", "Sign in to Gmail", "Sign out of Gmail",
                "Apple Mail (Coming soon)", "Yahoo Mail (Coming soon)", "Watch Microsoft Teams", "Watch Outlook mail", "Watch Gmail"
            })
                Check(program.Contains(entry), "Windows tray is missing account or source control: " + entry);
            Match windowsAction = Regex.Match(program, @"(?s)private static void OpenAccountDashboard\(string action\)\s*\{(.*?)\n        \}");
            Check(windowsAction.Success && windowsAction.Value.Contains("catch (Win32Exception)")
                && windowsAction.Value.Contains("catch (InvalidOperationException)")
                && !windowsAction.Value.Contains("catch (Exception)"),
                "Browser launch errors must use specific exceptions, not a silent catch-all.");
            Check(program.Contains("MessageBox.Show(\"Could not open your browser. Open \" + ApiBase + \"/")
                && program.Contains("catch (Win32Exception) { ShowAccountDashboardError(); }")
                && program.Contains("catch (InvalidOperationException) { ShowAccountDashboardError(); }"),
                "Browser launch errors must show generic actionable guidance without exception text.");
            string mac = File.ReadAllText(Path.Combine(root, @"macos\SlopGrenadeOverlay.swift"));
            foreach (string entry in new[] {
                "Sign in to Microsoft 365", "Sign out of Microsoft 365", "Sign in to Gmail", "Sign out of Gmail",
                "Apple Mail (Coming soon)", "Yahoo Mail (Coming soon)", "Watch Microsoft Teams", "Watch Outlook mail", "Watch Gmail"
            })
                Check(mac.Contains(entry), "macOS menu is missing account or source control: " + entry);
            Check(mac.Contains("openAccountDashboard(query:") && mac.Contains("NSWorkspace.shared.open(url)"),
                "macOS account actions must open only the local dashboard in the system browser.");
            Check(mac.Contains("let prefix = \"127.0.0.1:\"") && mac.Contains("bind.hasPrefix(prefix)")
                && mac.Contains("portText.utf8.allSatisfy") && mac.Contains("(1...65535).contains(port)")
                && mac.Contains("AppDelegate.localApiBase(httpBind: ProcessInfo.processInfo.environment[\"HTTP_BIND\"])"),
                "macOS must use only a validated loopback daemon port.");
            string shells = mac;
            foreach (string path in Directory.GetFiles(Path.Combine(root, "desktop"), "*.cs", SearchOption.AllDirectories))
                shells += File.ReadAllText(path);
            foreach (string forbidden in new[] {
                "accounts.google.com", "oauth2.googleapis.com", "gmail.googleapis.com",
                "/api/v1/gmail/authorize", "/api/v1/auth/google/callback",
                "access_token", "refresh_token", "client_secret", "code_verifier", "Bearer "
            })
                Check(!shells.Contains(forbidden), "Desktop shells must not implement Gmail OAuth or accept credentials.");
            string preferences = File.ReadAllText(Path.Combine(root, @"desktop\Settings.cs"));
            Check(preferences.Contains("MonitorGmail") && !preferences.Contains("Token") && !preferences.Contains("Credential"),
                "Only the Gmail source-filter preference may enter persisted shell preferences.");
            string gmailShell = File.ReadAllText(Path.Combine(root, @"desktop\LocalDashboard.cs"))
                + File.ReadAllText(Path.Combine(root, @"desktop\GmailStatus.cs"));
            Check(gmailShell.Contains("catch (WebException) { return GmailStatus.Unavailable; }")
                && gmailShell.Contains("catch (IOException) { return GmailStatus.Unavailable; }")
                && !gmailShell.Contains("catch (Exception)"),
                "Only expected local status transport failures may become unavailable status.");
            foreach (string storage in new[] { "Registry", "WriteAll", "AppendAll", "UserDefaults", "Keychain" })
                Check(!gmailShell.Contains(storage) && !mac.Contains(storage), "Gmail actions must not introduce a token store.");
            foreach (FieldInfo field in typeof(GmailStatus).GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                Check(field.IsInitOnly && (field.Name == "Summary" || field.Name == "Details"),
                    "The shell must retain only immutable sanitized display strings.");
        }
    }
}
