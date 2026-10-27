using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

namespace SlopGrenadeDesktop
{
    internal sealed class GmailStatus
    {
        internal const int MaxStatusLength = 65536;
        public static readonly GmailStatus Unavailable = new GmailStatus("Gmail: status unavailable", "Open dashboard to check connection.");
        public readonly string Summary;
        public readonly string Details;

        private GmailStatus(string summary, string details)
        {
            Summary = summary;
            Details = details;
        }

        public static GmailStatus FromAuthJson(string json)
        {
            if (string.IsNullOrEmpty(json) || json.Length > MaxStatusLength) return Unavailable;
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = MaxStatusLength, RecursionLimit = 16 };
                Dictionary<string, object> root = serializer.DeserializeObject(json) as Dictionary<string, object>;
                object value;
                if (root == null || !root.TryGetValue("gmail", out value)) return Unavailable;
                Dictionary<string, object> gmail = value as Dictionary<string, object>;
                if (gmail == null || !HasBool(gmail, "enabled") || !HasBool(gmail, "configured")) return Unavailable;
                if (!(bool)gmail["enabled"]) return new GmailStatus("Gmail: disabled", "Enable Gmail in the local daemon.");
                if (!(bool)gmail["configured"]) return new GmailStatus("Gmail: setup required", "Configure Gmail in the local daemon.");
                if (!gmail.TryGetValue("accounts", out value)) return Unavailable;
                object[] accounts = value as object[];
                if (accounts == null) return Unavailable;
                if (accounts.Length == 0)
                    return new GmailStatus("Gmail: disconnected", "Connect again after a daemon restart.");

                int connected = 0, reconnect = 0;
                bool hasError = false;
                DateTimeOffset latestScan = DateTimeOffset.MinValue;
                foreach (object accountValue in accounts)
                {
                    Dictionary<string, object> account = accountValue as Dictionary<string, object>;
                    if (account == null || !HasBool(account, "connected") || !HasBool(account, "reconnectRequired")) return Unavailable;
                    if ((bool)account["reconnectRequired"]) reconnect++;
                    else if ((bool)account["connected"]) connected++;
                    if (account.TryGetValue("error", out value) && value is string && !string.IsNullOrEmpty((string)value)) hasError = true;
                    DateTimeOffset scannedAt;
                    if (account.TryGetValue("lastSuccessfulScan", out value) && value is string
                        && DateTimeOffset.TryParse((string)value, CultureInfo.InvariantCulture, DateTimeStyles.None, out scannedAt)
                        && scannedAt > latestScan)
                        latestScan = scannedAt;
                }
                // Project only counts and timestamps; do not retain labels, IDs, or provider text.
                string summary = string.Format(CultureInfo.InvariantCulture, "Gmail: {0}/{1} connected", connected, accounts.Length);
                if (reconnect > 0) summary += "; " + reconnect.ToString(CultureInfo.InvariantCulture) + " reconnect required";
                string details = latestScan == DateTimeOffset.MinValue ? "No successful scan"
                    : "Last scan: " + latestScan.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
                if (hasError) details += "; temporary error (see dashboard)";
                return new GmailStatus(summary, details);
            }
            catch (ArgumentException) { return Unavailable; }
            catch (InvalidOperationException) { return Unavailable; }
        }

        private static bool HasBool(Dictionary<string, object> values, string name)
        {
            object value;
            return values.TryGetValue(name, out value) && value is bool;
        }
    }
}
