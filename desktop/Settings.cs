// Settings.cs
// User preferences persisted under HKCU\Software\SlopGrenade.

using System;
using Microsoft.Win32;

namespace SlopGrenadeDesktop
{
    internal sealed class Settings
    {
        private const string KeyPath = @"Software\SlopGrenade";

        public bool SoundEnabled;
        /// <summary>0..100.</summary>
        public int Volume = 70;
        public bool MonitorTeams = true;
        public bool MonitorOutlook = true;
        public bool SlopEffects = true;
        public bool CalmEffects = true;
        /// <summary>Seconds slop must sit on screen before flies gather.</summary>
        public int FlyDelaySeconds = 45;

        public static Settings Load()
        {
            Settings s = new Settings();
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(KeyPath, false))
                {
                    if (k == null) return s;
                    s.SoundEnabled = ReadInt(k, "SoundEnabled", 0) != 0;
                    s.Volume = Math.Max(0, Math.Min(100, ReadInt(k, "Volume", 70)));
                    s.MonitorTeams = ReadInt(k, "MonitorTeams", 1) != 0;
                    s.MonitorOutlook = ReadInt(k, "MonitorOutlook", 1) != 0;
                    s.SlopEffects = ReadInt(k, "SlopEffects", 1) != 0;
                    s.CalmEffects = ReadInt(k, "CalmEffects", 1) != 0;
                    s.FlyDelaySeconds = Math.Max(5, Math.Min(3600, ReadInt(k, "FlyDelaySeconds", 45)));
                }
            }
            catch (Exception)
            {
            }
            return s;
        }

        public void Save()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(KeyPath))
                {
                    if (k == null) return;
                    k.SetValue("SoundEnabled", SoundEnabled ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("Volume", Volume, RegistryValueKind.DWord);
                    k.SetValue("MonitorTeams", MonitorTeams ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("MonitorOutlook", MonitorOutlook ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("SlopEffects", SlopEffects ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("CalmEffects", CalmEffects ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("FlyDelaySeconds", FlyDelaySeconds, RegistryValueKind.DWord);
                }
            }
            catch (Exception)
            {
            }
        }

        private static int ReadInt(RegistryKey k, string name, int fallback)
        {
            object v = k.GetValue(name);
            if (v is int) return (int)v;
            int parsed;
            if (v != null && int.TryParse(v.ToString(), out parsed)) return parsed;
            return fallback;
        }
    }
}
