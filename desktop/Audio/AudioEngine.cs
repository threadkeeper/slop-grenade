// AudioEngine.cs
// Small real-time mixer on top of the Win32 waveOut API: 44.1 kHz stereo,
// four ~23 ms buffers, equal-power panning, per-voice pitch (bullet-time
// slows the fuse) and click-free loops. Sound is optional and off by default.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace SlopGrenadeDesktop
{
    /// <summary>Fire-and-forget sound output used by the World.</summary>
    internal interface ISfxSink
    {
        void Play(string name, float pan, float gain, float rate);
        /// <summary>Start/update a looping voice, or stop it when name is null.</summary>
        void Loop(string id, string name, float pan, float gain, float rate);
    }

    internal sealed class AudioEngine : ISfxSink, IDisposable
    {
        private const int Rate = SfxBank.SampleRate;
        private const int Frames = 1024;
        private const int BufferCount = 4;

        private sealed class Voice
        {
            public float[] Data;
            public double Pos;
            public float Rate = 1f;
            public float L, R;
            public float TargetL, TargetR;
            public bool Looping;
            public bool Stopping;
            public bool Done;
        }

        private readonly object _lock = new object();
        private readonly List<Voice> _voices = new List<Voice>();
        private readonly Dictionary<string, Voice> _loops = new Dictionary<string, Voice>();
        private Dictionary<string, float[]> _bank;
        private IntPtr _hwo = IntPtr.Zero;
        private IntPtr[] _hdr;
        private IntPtr[] _data;
        private bool[] _queued;
        private Thread _thread;
        private volatile bool _running;
        private volatile bool _enabled;
        private float _master = 0.8f;
        private readonly float[] _mix = new float[Frames * 2];
        private readonly short[] _pcm = new short[Frames * 2];
        private static readonly int HdrSize = Marshal.SizeOf(typeof(NativeMethods.WAVEHDR));
        private static readonly int FlagsOffset = (int)Marshal.OffsetOf(typeof(NativeMethods.WAVEHDR), "dwFlags");

        public bool Enabled { get { return _enabled; } }

        /// <summary>Master volume 0..1.</summary>
        public float Volume
        {
            get { return _master; }
            set { _master = M.Clamp01(value); }
        }

        public void SetEnabled(bool on)
        {
            if (on == _enabled) return;
            _enabled = on;
            if (on) Start();
            else Stop();
        }

        private void Start()
        {
            if (_running) return;
            _running = true;
            _thread = new Thread(Run);
            _thread.IsBackground = true;
            _thread.Name = "SlopGrenade Audio";
            _thread.Priority = ThreadPriority.AboveNormal;
            _thread.Start();
        }

        private void Stop()
        {
            _running = false;
            Thread t = _thread;
            if (t != null) t.Join(1000);
            _thread = null;
            lock (_lock)
            {
                _voices.Clear();
                _loops.Clear();
            }
        }

        private bool OpenDevice()
        {
            NativeMethods.WAVEFORMATEX fmt = new NativeMethods.WAVEFORMATEX();
            fmt.wFormatTag = 1;
            fmt.nChannels = 2;
            fmt.nSamplesPerSec = Rate;
            fmt.wBitsPerSample = 16;
            fmt.nBlockAlign = 4;
            fmt.nAvgBytesPerSec = Rate * 4;
            fmt.cbSize = 0;
            if (NativeMethods.waveOutOpen(out _hwo, NativeMethods.WAVE_MAPPER, ref fmt, IntPtr.Zero, IntPtr.Zero, NativeMethods.CALLBACK_NULL) != 0)
            {
                _hwo = IntPtr.Zero;
                return false;
            }
            _hdr = new IntPtr[BufferCount];
            _data = new IntPtr[BufferCount];
            _queued = new bool[BufferCount];
            for (int i = 0; i < BufferCount; i++)
            {
                _data[i] = Marshal.AllocHGlobal(Frames * 4);
                _hdr[i] = Marshal.AllocHGlobal(HdrSize);
                NativeMethods.WAVEHDR h = new NativeMethods.WAVEHDR();
                h.lpData = _data[i];
                h.dwBufferLength = Frames * 4;
                Marshal.StructureToPtr(h, _hdr[i], false);
                NativeMethods.waveOutPrepareHeader(_hwo, _hdr[i], HdrSize);
            }
            return true;
        }

        private void CloseDevice()
        {
            if (_hwo == IntPtr.Zero) return;
            NativeMethods.waveOutReset(_hwo);
            for (int i = 0; i < BufferCount; i++)
            {
                NativeMethods.waveOutUnprepareHeader(_hwo, _hdr[i], HdrSize);
                Marshal.FreeHGlobal(_hdr[i]);
                Marshal.FreeHGlobal(_data[i]);
            }
            NativeMethods.waveOutClose(_hwo);
            _hwo = IntPtr.Zero;
        }

        private void Run()
        {
            try
            {
                if (_bank == null) _bank = SfxBank.BuildAll();
                if (!OpenDevice()) { _running = false; return; }
                while (_running)
                {
                    bool wrote = false;
                    for (int i = 0; i < BufferCount; i++)
                    {
                        if (_queued[i])
                        {
                            int flags = Marshal.ReadInt32(_hdr[i], FlagsOffset);
                            if ((flags & NativeMethods.WHDR_DONE) == 0) continue;
                            _queued[i] = false;
                        }
                        MixInto(_data[i]);
                        NativeMethods.waveOutWrite(_hwo, _hdr[i], HdrSize);
                        _queued[i] = true;
                        wrote = true;
                    }
                    if (!wrote) Thread.Sleep(4);
                }
            }
            catch (Exception)
            {
                _running = false;
            }
            finally
            {
                CloseDevice();
            }
        }

        private void MixInto(IntPtr dest)
        {
            Array.Clear(_mix, 0, _mix.Length);
            lock (_lock)
            {
                for (int vi = 0; vi < _voices.Count; vi++)
                {
                    Voice v = _voices[vi];
                    float[] d = v.Data;
                    int n = d.Length;
                    float tl = v.Stopping ? 0f : v.TargetL;
                    float tr = v.Stopping ? 0f : v.TargetR;
                    float dl = (tl - v.L) / Frames, dr = (tr - v.R) / Frames;
                    float l = v.L, r = v.R;
                    double pos = v.Pos;
                    double rate = v.Rate;
                    for (int f = 0; f < Frames; f++)
                    {
                        int i0 = (int)pos;
                        if (i0 >= n - 1)
                        {
                            if (v.Looping) { pos -= n - 1; i0 = (int)pos; }
                            else { v.Done = true; break; }
                        }
                        float fr = (float)(pos - i0);
                        float smp = d[i0] + (d[i0 + 1] - d[i0]) * fr;
                        l += dl;
                        r += dr;
                        _mix[f * 2] += smp * l;
                        _mix[f * 2 + 1] += smp * r;
                        pos += rate;
                    }
                    v.Pos = pos;
                    v.L = tl;
                    v.R = tr;
                    if (v.Stopping && Math.Abs(v.L) < 1e-4f) v.Done = true;
                }
                _voices.RemoveAll(delegate(Voice v) { return v.Done; });
            }
            float master = _master;
            for (int i = 0; i < _mix.Length; i++)
            {
                float x = _mix[i] * master;
                // soft limiter keeps stacked explosions from clipping harshly
                if (x > 0.85f) x = 0.85f + (x - 0.85f) / (1f + (x - 0.85f) * 6f);
                else if (x < -0.85f) x = -0.85f + (x + 0.85f) / (1f - (x + 0.85f) * 6f);
                if (x > 1f) x = 1f;
                if (x < -1f) x = -1f;
                _pcm[i] = (short)(x * 32000f);
            }
            Marshal.Copy(_pcm, 0, dest, _pcm.Length);
        }

        private static void PanGains(float pan, float gain, out float l, out float r)
        {
            float a = (M.Clamp(pan, -1f, 1f) + 1f) * M.PI * 0.25f;
            l = M.Cos(a) * gain;
            r = M.Sin(a) * gain;
        }

        public void Play(string name, float pan, float gain, float rate)
        {
            if (!_enabled || _bank == null) return;
            float[] data;
            if (!_bank.TryGetValue(name, out data)) return;
            Voice v = new Voice();
            v.Data = data;
            v.Rate = Math.Max(0.1f, rate) ;
            PanGains(pan, gain, out v.TargetL, out v.TargetR);
            v.L = v.TargetL;
            v.R = v.TargetR;
            lock (_lock)
            {
                if (_voices.Count > 24) _voices.RemoveAt(0);
                _voices.Add(v);
            }
        }

        public void Loop(string id, string name, float pan, float gain, float rate)
        {
            if (!_enabled || _bank == null) return;
            lock (_lock)
            {
                Voice v;
                bool has = _loops.TryGetValue(id, out v);
                if (name == null)
                {
                    if (has)
                    {
                        v.Stopping = true;
                        _loops.Remove(id);
                    }
                    return;
                }
                if (!has)
                {
                    float[] data;
                    if (!_bank.TryGetValue(name, out data)) return;
                    v = new Voice();
                    v.Data = data;
                    v.Looping = true;
                    _loops[id] = v;
                    _voices.Add(v);
                }
                v.Rate = Math.Max(0.1f, rate);
                PanGains(pan, gain, out v.TargetL, out v.TargetR);
            }
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
