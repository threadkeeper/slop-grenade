// SfxBank.cs
// Procedural sound effects: no audio files ship with the app. Each effect is
// synthesised into a mono float buffer at 44.1 kHz. Recipes mirror
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

        private static void Bloop(float[] o, float start, float f0, float f1, float dur, float amp)
        {
            int s0 = (int)Math.Round(start * SampleRate);
            int n = (int)Math.Round(dur * SampleRate);
            double ph = 0;
            for (int i = 0; i < n && s0 + i < o.Length; i++)
            {
                double t = (double)i / SampleRate;
                double f = f1 + (f0 - f1) * Math.Exp(-t * 26);
                ph += 2 * Math.PI * f / SampleRate;
                double env = Math.Sin(Math.Min(1.0, t / 0.004) * Math.PI * 0.5) * Math.Exp(-t * (6 / dur));
                o[s0 + i] += (float)(Math.Sin(ph) * env * amp);
            }
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

        public static float[] Explosion()
        {
            float[] o = Buffer(2.8f);
            Noise nz = new Noise(7);
            Biquad body = new Biquad(), crack = new Biquad(), crackle = new Biquad(), wet = new Biquad(), rumble = new Biquad();
            crack.Set(FilterType.Hp, 1400, 0.7f);
            crackle.Set(FilterType.Bp, 2600, 1.4f);
            wet.Set(FilterType.Bp, 700, 2.2f);
            rumble.Set(FilterType.Lp, 110, 0.8f);
            double ph = 0;
            float brown = 0f;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                if ((i & 31) == 0) body.Set(FilterType.Lp, 170f + 4600f * M.Exp(-t * 5.2f), 0.9f);
                float w = nz.White();
                brown = brown * 0.985f + w * 0.15f;
                float attack = 1f - M.Exp(-t * 500f);
                float f = 30f + 62f * M.Exp(-t * 8.5f);
                ph += 2 * Math.PI * f / SampleRate;
                float sub = (float)Math.Sin(ph) * M.Exp(-t * 3.1f) * attack * 1.15f;
                float roar = body.Run(w * 0.7f + brown * 0.8f) * M.Exp(-t * 2.1f) * attack * 1.25f;
                float cr = crack.Run(w) * M.Exp(-t * 32f) * 0.85f;
                float p = 0.0045f * M.Exp(-t * 1.6f);
                float imp = nz.Uni() < p ? nz.White() * 1.6f : 0f;
                float deb = crackle.Run(imp) * 0.9f;
                float we = t > 0.03f ? wet.Run(w) * M.Exp(-(t - 0.03f) * 8f) * 0.55f : 0f;
                float rb = rumble.Run(brown * 3f) * M.Exp(-t * 1.05f) * 0.9f;
                o[i] = sub + roar + cr + deb + we + rb;
            }
            Bloop(o, 0.07f, 420, 90, 0.16f, 0.35f);
            Bloop(o, 0.19f, 360, 80, 0.18f, 0.3f);
            Bloop(o, 0.33f, 300, 70, 0.2f, 0.25f);
            Bloop(o, 0.52f, 260, 65, 0.22f, 0.18f);
            return Finish(o, 0.98f, 1.7f);
        }

        public static float[] Throw()
        {
            float[] o = Buffer(0.6f);
            Noise nz = new Noise(11);
            Biquad bp = new Biquad();
            const float T = 0.55f;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                if ((i & 31) == 0) bp.Set(FilterType.Bp, 500f + 1300f * (t / T), 1.3f);
                float env = M.Sin(M.PI * Math.Min(1f, t / T)); env *= env;
                float v = bp.Run(nz.White()) * env * 1.2f;
                float pe = M.Exp(-t * 9f);
                v += (M.Sin(M.TAU * 2210f * t) * 0.5f + M.Sin(M.TAU * 3350f * t) * 0.32f + M.Sin(M.TAU * 5120f * t) * 0.18f) * pe * 0.45f;
                o[i] = v;
            }
            return Finish(o, 0.8f, 0f);
        }

        public static float[] Fuse()
        {
            float[] o = Buffer(1.0f);
            Noise nz = new Noise(13);
            Biquad hp = new Biquad(), cr = new Biquad();
            hp.Set(FilterType.Hp, 2800, 0.7f);
            cr.Set(FilterType.Bp, 4200, 2f);
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float flutter = 0.75f + 0.25f * M.Sin(M.TAU * 23f * t) * M.Sin(M.TAU * 3f * t);
                float imp = nz.Uni() < 0.0016f ? nz.White() * 3f : 0f;
                o[i] = hp.Run(nz.White()) * 0.35f * flutter + cr.Run(imp);
            }
            return Loopify(Finish(o, 0.6f, 0f), 0.05f);
        }

        public static float[] SlowmoIn()
        {
            float[] o = Buffer(1.3f);
            Noise nz = new Noise(17);
            Biquad lp = new Biquad();
            double p1 = 0, p2 = 0;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                if ((i & 31) == 0) lp.Set(FilterType.Lp, 300f + 2600f * M.Exp(-t * 3f), 0.8f);
                float f = 55f + 190f * M.Exp(-t * 3.4f);
                p1 += 2 * Math.PI * f / SampleRate;
                p2 += 2 * Math.PI * f * 1.012 / SampleRate;
                float tone = (float)(Math.Sin(p1) + 0.6 * Math.Sin(p2 * 2) + 0.35 * Math.Sin(p1 * 3));
                float env = Math.Min(1f, t / 0.05f) * M.Exp(-t * 1.6f);
                float swell = M.Sin(M.PI * Math.Min(1f, t / 0.9f)) * 0.35f;
                o[i] = lp.Run(tone * env + nz.White() * swell);
            }
            return Finish(o, 0.75f, 1.2f);
        }

        public static float[] Splat()
        {
            float[] o = Buffer(0.8f);
            Noise nz = new Noise(19);
            Biquad bp = new Biquad();
            double ph = 0;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                if ((i & 31) == 0) bp.Set(FilterType.Bp, 300f + 900f * M.Exp(-t * 6f), 1.6f);
                float f = 50f + 70f * M.Exp(-t * 14f);
                ph += 2 * Math.PI * f / SampleRate;
                o[i] = bp.Run(nz.White()) * M.Exp(-t * 7.5f) * 1.3f + (float)Math.Sin(ph) * M.Exp(-t * 9f) * 0.8f;
            }
            Bloop(o, 0.04f, 380, 85, 0.14f, 0.4f);
            Bloop(o, 0.16f, 320, 75, 0.16f, 0.3f);
            return Finish(o, 0.9f, 1.3f);
        }

        public static float[] Cannon()
        {
            float[] o = Buffer(0.5f);
            Noise nz = new Noise(23);
            Biquad lp = new Biquad();
            lp.Set(FilterType.Lp, 900, 0.8f);
            double ph = 0;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float f = 58f + 110f * M.Exp(-t * 22f);
                ph += 2 * Math.PI * f / SampleRate;
                o[i] = (float)Math.Sin(ph) * M.Exp(-t * 10f) + lp.Run(nz.White()) * M.Exp(-t * 14f) * 0.7f;
            }
            return Finish(o, 0.85f, 1.4f);
        }

        public static float[] Whoosh()
        {
            float[] o = Buffer(1.4f);
            Noise nz = new Noise(29);
            Biquad bp = new Biquad();
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float sw = M.Sin(M.PI * Math.Min(1f, t / 1.4f));
                if ((i & 31) == 0) bp.Set(FilterType.Bp, 350f + 500f * sw, 0.9f);
                o[i] = bp.Run(nz.White()) * sw * sw;
            }
            return Finish(o, 0.55f, 0f);
        }

        public static float[] Squelch()
        {
            float[] o = Buffer(0.55f);
            Noise nz = new Noise(31);
            Biquad lp = new Biquad();
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                if ((i & 31) == 0) lp.Set(FilterType.Lp, 260f + 1300f * M.Exp(-t * 9f), 6f);
                o[i] = lp.Run(nz.White()) * M.Exp(-t * 7f) * 0.9f;
            }
            Bloop(o, 0.02f, 520, 120, 0.1f, 0.35f);
            Bloop(o, 0.11f, 420, 100, 0.12f, 0.25f);
            return Finish(o, 0.8f, 1.1f);
        }

        public static float[] Smoke()
        {
            float[] o = Buffer(2.2f);
            Noise nz = new Noise(37);
            Biquad lp = new Biquad();
            lp.Set(FilterType.Lp, 650, 0.7f);
            float b0 = 0f, b1 = 0f, b2 = 0f;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float w = nz.White();
                b0 = 0.99765f * b0 + w * 0.099046f;
                b1 = 0.963f * b1 + w * 0.2965164f;
                b2 = 0.57f * b2 + w * 1.0526913f;
                float pink = b0 + b1 + b2 + w * 0.1848f;
                float env = Math.Min(1f, t / 0.55f) * M.Exp(-Math.Max(0f, t - 0.55f) * 1.6f);
                o[i] = lp.Run(pink) * env;
            }
            return Finish(o, 0.5f, 0f);
        }

        public static float[] Twinkle()
        {
            float[] o = Buffer(0.9f);
            Noise nz = new Noise(41);
            float[] parts = new float[] { 3520f, 5290f, 7180f, 8870f };
            float[] decay = new float[] { 5f, 7f, 9f, 12f };
            float[] ph = new float[parts.Length];
            for (int k = 0; k < parts.Length; k++) ph[k] = nz.Uni() * M.TAU;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float v = 0f;
                for (int k = 0; k < parts.Length; k++) v += M.Sin(M.TAU * parts[k] * t + ph[k]) * M.Exp(-t * decay[k]) / (k + 1);
                o[i] = v * Math.Min(1f, t / 0.002f);
            }
            return Finish(o, 0.35f, 0f);
        }

        public static float[] Squeegee()
        {
            float[] o = Buffer(1.0f);
            Noise nz = new Noise(43);
            Biquad bp = new Biquad();
            bp.Set(FilterType.Bp, 2100, 1.2f);
            double ph = 0;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float f = 880f + 260f * M.Sin(M.TAU * 6.5f * t) + 60f * M.Sin(M.TAU * 41f * t);
                ph += 2 * Math.PI * f / SampleRate;
                float flutter = 0.6f + 0.4f * M.Sin(M.TAU * 31f * t);
                float env = M.Sin(M.PI * Math.Min(1f, t / 0.95f));
                o[i] = ((float)Math.Sin(ph) * 0.5f + (float)Math.Sin(ph * 2) * 0.18f) * flutter * env * 0.8f + bp.Run(nz.White()) * env * 0.5f;
            }
            return Finish(o, 0.7f, 0.8f);
        }

        public static float[] Buzz()
        {
            float[] o = Buffer(2.0f);
            Noise nz = new Noise(47);
            Biquad bp = new Biquad();
            bp.Set(FilterType.Bp, 520, 0.6f);
            double ph = 0;
            for (int i = 0; i < o.Length; i++)
            {
                float t = (float)i / SampleRate;
                float f = 192f + 9f * M.Sin(M.TAU * 0.5f * t) + 5f * M.Sin(M.TAU * 1.5f * t + 1f) + 3f * M.Sin(M.TAU * 7f * t);
                ph += 2 * Math.PI * f / SampleRate;
                float saw = 0f;
                for (int k = 1; k <= 7; k++) saw += (float)Math.Sin(ph * k) / k;
                float am = 0.8f + 0.2f * M.Sin(M.TAU * 14f * t);
                o[i] = bp.Run(saw * am + nz.White() * 0.05f);
            }
            return Loopify(Finish(o, 0.5f, 0f), 0.04f);
        }

        /// <summary>Synthesises every effect (takes a few hundred ms; call off the UI thread).</summary>
        public static Dictionary<string, float[]> BuildAll()
        {
            Dictionary<string, float[]> d = new Dictionary<string, float[]>();
            d["explosion"] = Explosion();
            d["throw"] = Throw();
            d["fuse"] = Fuse();
            d["slowmo_in"] = SlowmoIn();
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
