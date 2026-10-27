// DrawLog.cs
// Records drawing failures to %LOCALAPPDATA%\SlopGrenade\overlay-errors.log so a
// broken effect can be pinned down. Each distinct failure is written once per
// run, and the log is capped so it can never grow without bound.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace SlopGrenadeDesktop
{
    internal static class DrawLog
    {
        private static readonly HashSet<string> Seen = new HashSet<string>();
        private static int _written;
        private static string _path;

        public static string LogPath
        {
            get
            {
                if (_path == null)
                {
                    string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SlopGrenade");
                    _path = Path.Combine(dir, "overlay-errors.log");
                }
                return _path;
            }
        }

        public static void Report(string what, Exception ex)
        {
            lock (Seen)
            {
                string key = what + "|" + ex.GetType().Name + "|" + ex.Message;
                if (!Seen.Add(key) || _written >= 40) return;
                _written++;
                string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  [" + what + "] " + ex;
                Trace.WriteLine("Slop Grenade overlay: " + line);
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                    if (File.Exists(LogPath) && new FileInfo(LogPath).Length > 512 * 1024) File.Delete(LogPath);
                    File.AppendAllText(LogPath, line + Environment.NewLine + Environment.NewLine);
                }
                catch (Exception)
                {
                    // logging must never break drawing
                }
            }
        }
    }
}
