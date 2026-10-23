// Native.cs
// Win32 interop for the click-through layered overlay (per-pixel alpha DIB
// presented with UpdateLayeredWindowIndirect), high-resolution timers and the
// waveOut audio device. C# 5 / .NET Framework 4 compatible.

using System;
using System.Runtime.InteropServices;

namespace SlopGrenadeDesktop
{
    internal static class NativeMethods
    {
        public const int WS_EX_LAYERED = 0x00080000;
        public const int WS_EX_TRANSPARENT = 0x00000020;
        public const int WS_EX_TOPMOST = 0x00000008;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        public const byte AC_SRC_OVER = 0x00;
        public const byte AC_SRC_ALPHA = 0x01;
        public const int ULW_ALPHA = 0x00000002;
        public const uint DIB_RGB_COLORS = 0;

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

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int left;
            public int top;
            public int right;
            public int bottom;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct UPDATELAYEREDWINDOWINFO
        {
            public int cbSize;
            public IntPtr hdcDst;
            public IntPtr pptDst;
            public IntPtr psize;
            public IntPtr hdcSrc;
            public IntPtr pptSrc;
            public uint crKey;
            public IntPtr pblend;
            public uint dwFlags;
            public IntPtr prcDirty;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct BITMAPINFOHEADER
        {
            public int biSize;
            public int biWidth;
            public int biHeight;
            public short biPlanes;
            public short biBitCount;
            public int biCompression;
            public int biSizeImage;
            public int biXPelsPerMeter;
            public int biYPelsPerMeter;
            public int biClrUsed;
            public int biClrImportant;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
            IntPtr hdcSrc, ref POINT pptSrc, uint crKey, ref BLENDFUNCTION pblend, uint dwFlags);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool UpdateLayeredWindowIndirect(IntPtr hwnd, ref UPDATELAYEREDWINDOWINFO pULWInfo);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("user32.dll")]
        public static extern bool DestroyIcon(IntPtr hIcon);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", ExactSpelling = true)]
        public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER pbmi, uint iUsage,
            out IntPtr ppvBits, IntPtr hSection, uint dwOffset);

        [DllImport("gdi32.dll")]
        public static extern bool GdiFlush();

        [DllImport("winmm.dll")]
        public static extern uint timeBeginPeriod(uint uPeriod);

        [DllImport("winmm.dll")]
        public static extern uint timeEndPeriod(uint uPeriod);

        // ---- waveOut ----------------------------------------------------------------

        public const int WAVE_MAPPER = -1;
        public const int CALLBACK_NULL = 0;
        public const int WHDR_DONE = 0x00000001;

        [StructLayout(LayoutKind.Sequential)]
        public struct WAVEFORMATEX
        {
            public short wFormatTag;
            public short nChannels;
            public int nSamplesPerSec;
            public int nAvgBytesPerSec;
            public short nBlockAlign;
            public short wBitsPerSample;
            public short cbSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct WAVEHDR
        {
            public IntPtr lpData;
            public int dwBufferLength;
            public int dwBytesRecorded;
            public IntPtr dwUser;
            public int dwFlags;
            public int dwLoops;
            public IntPtr lpNext;
            public IntPtr reserved;
        }

        [DllImport("winmm.dll")]
        public static extern int waveOutOpen(out IntPtr hWaveOut, int uDeviceID, ref WAVEFORMATEX lpFormat,
            IntPtr dwCallback, IntPtr dwInstance, int dwFlags);

        [DllImport("winmm.dll")]
        public static extern int waveOutPrepareHeader(IntPtr hWaveOut, IntPtr lpWaveOutHdr, int uSize);

        [DllImport("winmm.dll")]
        public static extern int waveOutUnprepareHeader(IntPtr hWaveOut, IntPtr lpWaveOutHdr, int uSize);

        [DllImport("winmm.dll")]
        public static extern int waveOutWrite(IntPtr hWaveOut, IntPtr lpWaveOutHdr, int uSize);

        [DllImport("winmm.dll")]
        public static extern int waveOutReset(IntPtr hWaveOut);

        [DllImport("winmm.dll")]
        public static extern int waveOutClose(IntPtr hWaveOut);
    }
}
