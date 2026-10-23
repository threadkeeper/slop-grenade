// Palette.cs
// "Ink & cel" art-direction colours. Mirrors web/src/lib/engine/palette.ts.

namespace SlopGrenadeDesktop
{
    internal sealed class SlopPalette
    {
        public int Deep;
        public int Shadow;
        public int Base;
        public int Light;
        public int Gloss;
        public int Hatch;
    }

    internal static class Palette
    {
        public const int Ink = 0x1b1420;

        public static readonly SlopPalette Pink = new SlopPalette
        {
            Deep = 0x7c0f4a, Shadow = 0xd21c78, Base = 0xff4fa8, Light = 0xffa3d2, Gloss = 0xffffff, Hatch = 0x5a0836
        };

        public static readonly SlopPalette Blue = new SlopPalette
        {
            Deep = 0x0d2f7c, Shadow = 0x1f63d6, Base = 0x3d9dff, Light = 0xaad9ff, Gloss = 0xffffff, Hatch = 0x0a2160
        };

        public const int BrassDark = 0x8a5a1c;
        public const int BrassBase = 0xe3a93b;
        public const int BrassLight = 0xffe18c;
        public const int SteelDark = 0x3c4a5a;
        public const int SteelBase = 0x93a7bc;
        public const int SteelLight = 0xe2ebf4;

        private static readonly int[] HeatRamp = new int[]
        {
            0xffffff, 0xfff3a6, 0xffd23f, 0xff9a1f, 0xf25a1c, 0xc8402a, 0x7a6a70, 0x4e4a54
        };

        /// <summary>Explosion heat ramp, t in [0,1] (1 = hottest).</summary>
        public static int Heat(float t)
        {
            float k = M.Clamp01(1f - t) * (HeatRamp.Length - 1);
            int i = (int)k;
            if (i >= HeatRamp.Length - 1) return HeatRamp[HeatRamp.Length - 1];
            return M.Mix(HeatRamp[i], HeatRamp[i + 1], k - i);
        }

        public static SlopPalette ForSide(Side side)
        {
            return side == Side.Left ? Pink : Blue;
        }
    }

    internal enum Side
    {
        Left,
        Right
    }

    internal enum EffectTier
    {
        HumanSparkle,
        PeacefulCloud,
        InnocentFruit,
        SlopSplat,
        SlopGrenade
    }
}
