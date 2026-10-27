using System;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;

namespace SlopGrenadeDesktop
{
    internal sealed class EffectNotice
    {
        public long Sequence { get; set; }
        public string SqueegeeSide { get; set; }
        public bool DataWiped { get; set; }
        public long? ResetGeneration { get; set; }
        public EffectMessage Report { get; set; }

        public static EffectNotice Parse(string json)
        {
            const string invalid = "Invalid animation metadata.";
            EffectNotice notice;
            try
            {
                notice = new JavaScriptSerializer { MaxJsonLength = 131072, RecursionLimit = 32 }.Deserialize<EffectNotice>(json);
            }
            catch (ArgumentException) { throw new FormatException(invalid); }
            catch (InvalidOperationException) { throw new FormatException(invalid); }
            catch (FormatException) { throw new FormatException(invalid); }
            catch (OverflowException) { throw new FormatException(invalid); }
            catch (InvalidCastException) { throw new FormatException(invalid); }
            if (notice == null || notice.Sequence < 1 || notice.ResetGeneration < 0) throw new FormatException(invalid);
            if (notice.DataWiped) return notice;
            if (notice.SqueegeeSide == "left" || notice.SqueegeeSide == "right") return notice;
            ValidateReport(notice.Report);
            return notice;
        }

        public static EffectMessage[] ParseLedgerReports(string json)
        {
            return ParseLedger(json).RecentReports;
        }

        public static LedgerSnapshot ParseLedger(string json)
        {
            const string invalid = "Invalid animation metadata.";
            LedgerSnapshot snapshot;
            try
            {
                snapshot = new JavaScriptSerializer { MaxJsonLength = 4194304, RecursionLimit = 32 }.Deserialize<LedgerSnapshot>(json);
            }
            catch (ArgumentException) { throw new FormatException(invalid); }
            catch (InvalidOperationException) { throw new FormatException(invalid); }
            catch (FormatException) { throw new FormatException(invalid); }
            catch (OverflowException) { throw new FormatException(invalid); }
            catch (InvalidCastException) { throw new FormatException(invalid); }
            if (snapshot == null || snapshot.ResetGeneration < 0) throw new FormatException(invalid);
            if (snapshot.RecentReports == null) snapshot.RecentReports = new EffectMessage[0];
            foreach (EffectMessage message in snapshot.RecentReports)
                ValidateReport(message);
            return snapshot;
        }

        public static void ValidateReport(EffectMessage message)
        {
            const string invalid = "Invalid animation metadata.";
            DateTimeOffset timestamp;
            if (message == null || string.IsNullOrEmpty(message.MessageId) || message.Breakdown == null ||
                message.Sender == null || message.SubjectOrTopic == null || message.RedactedPreview == null ||
                message.App == null || message.SlopScore < 0 || message.SlopScore > 100 || message.WordCount < 0 ||
                (message.Direction != "received" && message.Direction != "sent") ||
                (message.MonitorSide != "left" && message.MonitorSide != "right") ||
                !DateTimeOffset.TryParse(message.Timestamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out timestamp))
                throw new FormatException(invalid);
            message.TierValue();
            message.Sender = Clean(message.Sender, 320);
            message.SubjectOrTopic = Clean(message.SubjectOrTopic, 500);
            message.RedactedPreview = Clean(message.RedactedPreview, 500);
            message.App = Clean(message.App, 40);
            message.Summary = Clean(message.Summary ?? "", 160);
        }

        private static string Clean(string value, int limit)
        {
            StringBuilder result = new StringBuilder(Math.Min(value.Length, limit));
            for (int i = 0; i < value.Length && result.Length < limit; i++)
                result.Append(char.IsControl(value[i]) ? ' ' : value[i]);
            if (value.Length > limit) result.Append("...");
            return result.ToString();
        }
    }

    internal sealed class LedgerSnapshot
    {
        public long ResetGeneration { get; set; }
        public EffectMessage[] RecentReports { get; set; }
    }

    internal sealed class EffectBreakdown
    {
        public double LexicalScore { get; set; }
        public double StructuralScore { get; set; }
        public double BurstinessScore { get; set; }
        public double HandoffScore { get; set; }
    }

    internal sealed class EffectMessage
    {
        public string MessageId { get; set; }
        public string App { get; set; }
        public string Direction { get; set; }
        public string Sender { get; set; }
        public string SubjectOrTopic { get; set; }
        public string Timestamp { get; set; }
        public int WordCount { get; set; }
        public int SlopScore { get; set; }
        public string Tier { get; set; }
        public string MonitorSide { get; set; }
        public EffectBreakdown Breakdown { get; set; }
        public string RedactedPreview { get; set; }
        public string Summary { get; set; }

        public EffectTier TierValue()
        {
            switch (Tier)
            {
                case "slop_grenade": return EffectTier.SlopGrenade;
                case "slop_splat": return EffectTier.SlopSplat;
                case "innocent_fruit": return EffectTier.InnocentFruit;
                case "peaceful_cloud": return EffectTier.PeacefulCloud;
                case "human_sparkle": return EffectTier.HumanSparkle;
                default: throw new FormatException("Invalid animation metadata.");
            }
        }

        public string DetailsText()
        {
            string type = Tier == "slop_grenade" ? "slop-grenade" : Tier == "slop_splat" ? "ai-cannon" :
                Tier == "innocent_fruit" ? "sprinkled" : Tier == "peaceful_cloud" ? "polish" : "human";
            string source = App == "teams" ? "Teams" : App == "outlook" ? "Outlook" : App == "gmail" ? "Gmail" : App;
            return string.Format(CultureInfo.InvariantCulture,
                "Slop {0}% - {1}\nDate & time: {2}\nSource: {3} | {4}\nFrom: {5}\nTo: {6}\n" +
                "L:{7:0.##}  S:{8:0.##}  B:{9:0.##}  H:{10:0.##} | {11} words\nSubject: {12}\nPreview: {13}",
                SlopScore, type, DateTimeOffset.Parse(Timestamp, CultureInfo.InvariantCulture).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss zzz"),
                source, Direction == "received" ? "Incoming" : "Outgoing", Sender,
                Direction == "received" ? "You" : "Team / Recipient", Breakdown.LexicalScore, Breakdown.StructuralScore,
                Breakdown.BurstinessScore, Breakdown.HandoffScore, WordCount, SubjectOrTopic, RedactedPreview);
        }
    }
}
