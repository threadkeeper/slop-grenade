// MathUtil.cs
// Allocation-free math helpers shared by every effect. Mirrors web/src/lib/engine/math.ts.

using System;

namespace SlopGrenadeDesktop
{
    /// <summary>Deterministic Mulberry32 PRNG.</summary>
    internal sealed class Rng
    {
        private uint _state;

        public Rng(uint seed)
        {
            _state = seed == 0 ? 0x9e3779b9u : seed;
        }

        public float Next()
        {
            unchecked
            {
                _state += 0x6d2b79f5u;
                uint t = _state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (float)((t ^ (t >> 14)) / 4294967296.0);
            }
        }

        public float Range(float a, float b) { return a + (b - a) * Next(); }

        public int Int(int n) { if (n <= 1) return 0; int v = (int)(Next() * n); return v >= n ? n - 1 : v; }

        public bool Chance(float p) { return Next() < p; }

        public float Sign() { return Next() < 0.5f ? -1f : 1f; }
    }

    internal static class M
    {
        public const float PI = 3.14159265f;
        public const float TAU = 6.28318531f;

        public static float Clamp(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
        public static float Clamp01(float v) { return v < 0f ? 0f : (v > 1f ? 1f : v); }
        public static float Lerp(float a, float b, float t) { return a + (b - a) * t; }

        public static float Smoothstep(float e0, float e1, float x)
        {
            float t = Clamp01((x - e0) / (e1 - e0));
            return t * t * (3f - 2f * t);
        }

        public static float EaseOutCubic(float t) { float u = 1f - Clamp01(t); return 1f - u * u * u; }

        public static float EaseOutBack(float t)
        {
            const float c1 = 1.70158f;
            const float c3 = c1 + 1f;
            float u = Clamp01(t) - 1f;
            return 1f + c3 * u * u * u + c1 * u * u;
        }

        public static float Sin(float x) { return (float)Math.Sin(x); }
        public static float Cos(float x) { return (float)Math.Cos(x); }
        public static float Sqrt(float x) { return (float)Math.Sqrt(x); }
        public static float Exp(float x) { return (float)Math.Exp(x); }
        public static float Atan2(float y, float x) { return (float)Math.Atan2(y, x); }
        public static float Pow(float x, float y) { return (float)Math.Pow(x, y); }
        public static float Abs(float x) { return x < 0f ? -x : x; }
        public static float Max(float a, float b) { return a > b ? a : b; }
        public static float Min(float a, float b) { return a < b ? a : b; }
        public static float Len(float x, float y) { return (float)Math.Sqrt(x * x + y * y); }
        public static float Len(float x, float y, float z) { return (float)Math.Sqrt(x * x + y * y + z * z); }
        public static float Floor(float x) { return (float)Math.Floor(x); }
        public static float Fract(float x) { return x - (float)Math.Floor(x); }

        public static float Hash2(int x, int y)
        {
            unchecked
            {
                int h = x * 374761393 + y * 668265263;
                h = (h ^ (int)((uint)h >> 13)) * 1274126177;
                h ^= (int)((uint)h >> 16);
                return (float)((uint)h / 4294967296.0);
            }
        }

        public static float Hash3(int x, int y, int z)
        {
            unchecked
            {
                int h = x * 374761393 + y * 668265263 + z * 1440662683;
                h = (h ^ (int)((uint)h >> 13)) * 1274126177;
                h ^= (int)((uint)h >> 16);
                return (float)((uint)h / 4294967296.0);
            }
        }

        public static float ValueNoise2(float x, float y)
        {
            int xi = (int)Math.Floor(x);
            int yi = (int)Math.Floor(y);
            float xf = x - xi;
            float yf = y - yi;
            float u = xf * xf * (3f - 2f * xf);
            float v = yf * yf * (3f - 2f * yf);
            float a = Hash2(xi, yi);
            float b = Hash2(xi + 1, yi);
            float c = Hash2(xi, yi + 1);
            float d = Hash2(xi + 1, yi + 1);
            return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
        }

        public static float ValueNoise3(float x, float y, float z)
        {
            int xi = (int)Math.Floor(x);
            int yi = (int)Math.Floor(y);
            int zi = (int)Math.Floor(z);
            float xf = x - xi;
            float yf = y - yi;
            float zf = z - zi;
            float u = xf * xf * (3f - 2f * xf);
            float v = yf * yf * (3f - 2f * yf);
            float w = zf * zf * (3f - 2f * zf);
            float c000 = Hash3(xi, yi, zi);
            float c100 = Hash3(xi + 1, yi, zi);
            float c010 = Hash3(xi, yi + 1, zi);
            float c110 = Hash3(xi + 1, yi + 1, zi);
            float c001 = Hash3(xi, yi, zi + 1);
            float c101 = Hash3(xi + 1, yi, zi + 1);
            float c011 = Hash3(xi, yi + 1, zi + 1);
            float c111 = Hash3(xi + 1, yi + 1, zi + 1);
            float x00 = c000 + (c100 - c000) * u;
            float x10 = c010 + (c110 - c010) * u;
            float x01 = c001 + (c101 - c001) * u;
            float x11 = c011 + (c111 - c011) * u;
            float y0 = x00 + (x10 - x00) * v;
            float y1 = x01 + (x11 - x01) * v;
            return y0 + (y1 - y0) * w;
        }

        /// <summary>Linear blend of two 0xRRGGBB colours.</summary>
        public static int Mix(int c1, int c2, float t)
        {
            float k = Clamp01(t);
            int r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
            int r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
            int r = (int)(r1 + (r2 - r1) * k + 0.5f);
            int g = (int)(g1 + (g2 - g1) * k + 0.5f);
            int b = (int)(b1 + (b2 - b1) * k + 0.5f);
            return (r << 16) | (g << 8) | b;
        }

        /// <summary>Multiplies each channel of a 0xRRGGBB colour.</summary>
        public static int MulRgb(int c, float r, float g, float b)
        {
            int cr = Math.Min(255, (int)(((c >> 16) & 255) * r + 0.5f));
            int cg = Math.Min(255, (int)(((c >> 8) & 255) * g + 0.5f));
            int cb = Math.Min(255, (int)((c & 255) * b + 0.5f));
            return (cr << 16) | (cg << 8) | cb;
        }

        /// <summary>Opaque 0xRRGGBB to premultiplied ARGB with the given alpha (0..255).</summary>
        public static int Premul(int rgb, int a)
        {
            if (a <= 0) return 0;
            if (a >= 255) return unchecked((int)0xff000000) | rgb;
            int r = ((rgb >> 16) & 255) * a / 255;
            int g = ((rgb >> 8) & 255) * a / 255;
            int b = (rgb & 255) * a / 255;
            return (a << 24) | (r << 16) | (g << 8) | b;
        }
    }
}
