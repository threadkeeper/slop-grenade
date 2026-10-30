// SfxBank.cs
// Procedural sound effects: no audio files ship with the app. Soft and quiet,
// in the spirit of early Macintosh games: sine and triangle tones with pitch
// glides, gentle filtered noise, a 22 kHz grain and a low-pass so nothing is
// harsh. Each effect is a mono float buffer at 44.1 kHz. Recipes mirror
// web/src/lib/engine/sfxSynth.ts.

using System;
using System.Collections.Generic;

namespace SlopGrenadeDesktop
{
    internal static class SfxBank
    {
        public const int SampleRate = 44100;

        private sealed class Noise
        {
            private uint _s;
            public Noise(uint seed) { _s = seed == 0 ? 1u : seed; }
            public float White()
            {
                uint x = _s;
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                _s = x;
                return (float)(x / 4294967296.0 * 2.0 - 1.0);
            }
            public float Uni() { return (White() + 1f) * 0.5f; }
        }

        private enum FilterType { Lp, Hp, Bp }

        private sealed class Biquad
        {
            private float _b0 = 1f, _b1, _b2, _a1, _a2, _x1, _x2, _y1, _y2;

            public void Set(FilterType type, float freq, float q)
            {
                double f = Math.Min(freq, SampleRate * 0.45);
                double w = 2.0 * Math.PI * f / SampleRate;
                double cw = Math.Cos(w);
                double alpha = Math.Sin(w) / (2.0 * q);
                double b0, b1, b2;
                if (type == FilterType.Lp) { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
                else if (type == FilterType.Hp) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
                else { b0 = alpha; b1 = 0; b2 = -alpha; }
                double a0 = 1 + alpha;
                _b0 = (float)(b0 / a0); _b1 = (float)(b1 / a0); _b2 = (float)(b2 / a0);
                _a1 = (float)(-2 * cw / a0); _a2 = (float)((1 - alpha) / a0);
            }

            public float Run(float x)
            {
                float y = _b0 * x + _b1 * _x1 + _b2 * _x2 - _a1 * _y1 - _a2 * _y2;
                _x2 = _x1; _x1 = x; _y2 = _y1; _y1 = y;
                return y;
            }
        }

        private static float[] Buffer(float seconds) { return new float[(int)Math.Round(seconds * SampleRate)]; }

        private static float[] Finish(float[] o, float peak, float drive)
        {
            if (drive > 0f)
            {
                double k = Math.Tanh(drive);
                for (int i = 0; i < o.Length; i++) o[i] = (float)(Math.Tanh(o[i] * drive) / k);
            }
            float m = 0f;
            for (int i = 0; i < o.Length; i++) m = Math.Max(m, Math.Abs(o[i]));
            if (m > 0f)
            {
                float g = peak / m;
                for (int i = 0; i < o.Length; i++) o[i] *= g;
            }
            int f = Math.Min(o.Length >> 1, (int)Math.Round(SampleRate * 0.004));
            for (int i = 0; i < f; i++)
            {
                o[i] *= (float)i / f;
                o[o.Length - 1 - i] *= (float)i / f;
            }
            return o;
        }

        private enum Wave { Sine, Tri, Square }

        private static double Osc(Wave wave, double ph)
        {
            double u = ph / (2 * Math.PI) - Math.Floor(ph / (2 * Math.PI));
            if (wave == Wave.Sine) return Math.Sin(ph);
            if (wave == Wave.Tri) return u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
            return u < 0.5 ? 1 : -1;
        }

        /// <summary>Tone gliding exponentially from f0 to f1; linear attack then (1 - t/dur)^decay.</summary>
        private static void Tone(float[] o, double start, double dur, double f0, double f1, Wave wave, double amp, double attack, double decay)
        {
            int s0 = (int)Math.Round(start * SampleRate);
            int n = (int)Math.Round(dur * SampleRate);
            double ph = 0;
            for (int i = 0; i < n && s0 + i < o.Length; i++)
            {
                double t = (double)i / SampleRate;
                double u = t / dur;
                double f = f0 * Math.Pow(f1 / f0, u);
                ph += 2 * Math.PI * f / SampleRate;
                double env = Math.Min(1.0, t / attack) * Math.Pow(1 - u, decay);
                o[s0 + i] += (float)(Osc(wave, ph) * env * amp);
            }
        }

        /// <summary>Low-passed noise whose cutoff glides from c0 to c1 (Hz).</summary>
        private static void Hush(float[] o, double start, double dur, double c0, double c1, double amp, double attack, double decay, Noise nz)
        {
            int s0 = (int)Math.Round(start * SampleRate);
            int n = (int)Math.Round(dur * SampleRate);
            Biquad lp = new Biquad();
            for (int i = 0; i < n && s0 + i < o.Length; i++)
            {
                double t = (double)i / SampleRate;
                double u = t / dur;
                if ((i & 31) == 0) lp.Set(FilterType.Lp, (float)(c0 * Math.Pow(c1 / c0, u)), 0.7f);
                double env = Math.Min(1.0, t / attack) * Math.Pow(1 - u, decay);
                o[s0 + i] += (float)(lp.Run(nz.White()) * env * amp);
            }
        }

        /// <summary>Early-Mac grain: hold every other sample (22 kHz) then soften with a low-pass.</summary>
        private static float[] Retro(float[] o, float cutoff)
        {
            for (int i = 1; i < o.Length; i += 2) o[i] = o[i - 1];
            Biquad a = new Biquad(), b = new Biquad();
            a.Set(FilterType.Lp, cutoff, 0.7f);
            b.Set(FilterType.Lp, cutoff, 0.7f);
            for (int i = 0; i < o.Length; i++) o[i] = b.Run(a.Run(o[i]));
            return o;
        }

        private static float[] Loopify(float[] x, float seconds)
        {
            int n = (int)Math.Round(seconds * SampleRate);
            float[] o = new float[x.Length - n];
            Array.Copy(x, o, o.Length);
            for (int i = 0; i < n; i++)
            {
                float k = (float)i / n;
                o[i] = x[i] * k + x[x.Length - n + i] * (1f - k);
            }
            return o;
        }

        /// <summary>The grenade: a round, soft "pomf" with a little cartoon pop at the end.</summary>
        public static float[] Explosion()
        {
            float[] o = Buffer(1.3f);
            Noise nz = new Noise(7);
            Tone(o, 0, 0.9, 150, 42, Wave.Sine, 1.0, 0.003, 1.6);
            Hush(o, 0, 1.1, 2600, 160, 0.75, 0.004, 2.2, nz);
            Tone(o, 0.2, 0.12, 330, 220, Wave.Tri, 0.22, 0.004, 1.2);
            Tone(o, 0.34, 0.14, 262, 175, Wave.Tri, 0.18, 0.004, 1.2);
            return Finish(Retro(o, 4200f), 0.78f, 0.6f);
        }

        /// <summary>Pin pulled and tossed: a light rising "whee".</summary>
        public static float[] Throw()
        {
            float[] o = Buffer(0.34f);
            Tone(o, 0, 0.32, 330, 880, Wave.Tri, 0.8, 0.01, 1.4);
            Tone(o, 0.02, 0.28, 660, 1320, Wave.Sine, 0.15, 0.01, 2);
            return Finish(Retro(o, 5000f), 0.45f, 0f);
        }

        /// <summary>Fuse: a gentle clock tick (loops).</summary>
        public static float[] Fuse()
        {
            float[] o = Buffer(0.54f);
            Noise nz = new Noise(13);
            for (int k = 0; k < 6; k++) Tone(o, k / 12.0, 0.018, 1800, 1500, Wave.Tri, 0.6, 0.001, 2);
            Hush(o, 0, 0.54, 2200, 2200, 0.05, 0.001, 0, nz);
            return Loopify(Finish(Retro(o, 5000f), 0.3f, 0f), 0.04f);
        }

        /// <summary>Goo landing: a round "plop".</summary>
        public static float[] Splat()
        {
            float[] o = Buffer(0.22f);
            Noise nz = new Noise(19);
            Tone(o, 0, 0.2, 600, 150, Wave.Sine, 1, 0.002, 2);
            Hush(o, 0, 0.05, 1800, 600, 0.25, 0.001, 2, nz);
            return Finish(Retro(o, 4000f), 0.55f, 0f);
        }

        /// <summary>AI cannon: a soft "pomp".</summary>
        public static float[] Cannon()
        {
            float[] o = Buffer(0.32f);
            Noise nz = new Noise(23);
            Tone(o, 0, 0.26, 260, 90, Wave.Tri, 0.9, 0.003, 1.8);
            Hush(o, 0, 0.18, 1400, 300, 0.4, 0.002, 2, nz);
            return Finish(Retro(o, 3800f), 0.5f, 0f);
        }

        /// <summary>Fruit tossed: a breathy swish.</summary>
        public static float[] Whoosh()
        {
            float[] o = Buffer(0.4f);
            Noise nz = new Noise(29);
            Biquad bp = new Biquad();
            for (int i = 0; i < o.Length; i++)
            {
                double u = (double)i / o.Length;
                if ((i & 31) == 0) bp.Set(FilterType.Bp, (float)(500 * Math.Pow(3.2, u)), 1.2f);
                o[i] = (float)(bp.Run(nz.White()) * Math.Sin(Math.PI * u));
            }
            return Finish(Retro(o, 4500f), 0.3f, 0f);
        }

        /// <summary>Fruit sticks in the goo: two little bloops.</summary>
        public static float[] Squelch()
        {
            float[] o = Buffer(0.3f);
            Tone(o, 0, 0.13, 420, 160, Wave.Sine, 1, 0.002, 1.6);
            Tone(o, 0.09, 0.16, 340, 120, Wave.Sine, 0.8, 0.002, 1.6);
            return Finish(Retro(o, 4000f), 0.5f, 0f);
        }

        /// <summary>Smoke rolling in: a quiet airy "fooo".</summary>
        public static float[] Smoke()
        {
            float[] o = Buffer(0.85f);
            Noise nz = new Noise(37);
            Biquad lp = new Biquad();
            lp.Set(FilterType.Lp, 900f, 0.7f);
            for (int i = 0; i < o.Length; i++)
            {
                double u = (double)i / o.Length;
                double e = Math.Sin(Math.PI * u);
                o[i] = (float)(lp.Run(nz.White()) * e * e);
            }
            Tone(o, 0.05, 0.7, 196, 165, Wave.Sine, 0.12, 0.15, 1);
            return Finish(Retro(o, 3500f), 0.28f, 0f);
        }

        /// <summary>Crystal twinkle: a three-note bell arpeggio (E6, G#6, B6).</summary>
        public static float[] Twinkle()
        {
            float[] o = Buffer(0.85f);
            double[] notes = new double[] { 1318.5, 1661.2, 1975.5 };
            for (int k = 0; k < notes.Length; k++)
            {
                Tone(o, k * 0.09, 0.6, notes[k], notes[k], Wave.Sine, 0.6, 0.002, 3);
                Tone(o, k * 0.09, 0.3, notes[k] * 2.76, notes[k] * 2.76, Wave.Sine, 0.12, 0.002, 4);
            }
            return Finish(Retro(o, 7000f), 0.4f, 0f);
        }

        /// <summary>Squeegee: rubbery squeak-squeak-squeak.</summary>
        public static float[] Squeegee()
        {
            float[] o = Buffer(0.62f);
            Tone(o, 0, 0.12, 1100, 1450, Wave.Tri, 0.7, 0.01, 0.8);
            Tone(o, 0.17, 0.12, 1150, 1500, Wave.Tri, 0.7, 0.01, 0.8);
            Tone(o, 0.34, 0.24, 1200, 900, Wave.Tri, 0.6, 0.01, 1.2);
            return Finish(Retro(o, 3000f), 0.35f, 0f);
        }

        /// <summary>Flies: a soft, low hum with a lazy wobble (loops).</summary>
        public static float[] Buzz()
        {
            float[] o = Buffer(1.04f);
            Biquad lp = new Biquad();
            lp.Set(FilterType.Lp, 700f, 0.7f);
            double ph = 0;
            for (int i = 0; i < o.Length; i++)
            {
                double t = (double)i / SampleRate;
                double f = 175 + 6 * Math.Sin(2 * Math.PI * 4 * t) + 3 * Math.Sin(2 * Math.PI * 11 * t);
                ph += 2 * Math.PI * f / SampleRate;
                o[i] = lp.Run((float)(Osc(Wave.Tri, ph) * (0.85 + 0.15 * Math.Sin(2 * Math.PI * 9 * t))));
            }
            return Loopify(Finish(Retro(o, 2500f), 0.25f, 0f), 0.04f);
        }

        public static Dictionary<string, float[]> BuildAll()
        {
            Dictionary<string, float[]> d = new Dictionary<string, float[]>();
            d["explosion"] = Explosion();
            d["throw"] = Throw();
            d["fuse"] = Fuse();
            d["splat"] = Splat();
            d["cannon"] = Cannon();
            d["whoosh"] = Whoosh();
            d["squelch"] = Squelch();
            d["smoke"] = Smoke();
            d["twinkle"] = Twinkle();
            d["squeegee"] = Squeegee();
            d["buzz"] = Buzz();
            return d;
        }
    }
}
