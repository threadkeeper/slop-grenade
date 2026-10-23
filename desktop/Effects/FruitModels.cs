// FruitModels.cs
// Procedural 3D models + cel materials for the 20 fruits. Mirrors
// web/src/lib/engine/fruitModels.ts (object space: y up, body radius ~1).

using System;

namespace SlopGrenadeDesktop
{
    internal static class FruitModels
    {
        public const int Count = 20;
        public const int Apple = 0, Pear = 1, Orange = 2, Lemon = 3, Strawberry = 4, Cherries = 5, Watermelon = 6,
            Pineapple = 7, Mango = 8, Kiwi = 9, Dragonfruit = 10, Grapes = 11, Peach = 12, Plum = 13, Pomegranate = 14,
            Fig = 15, Papaya = 16, Starfruit = 17, Blueberries = 18, Passionfruit = 19;

        public const int Skin = 0, Stem = 1, LeafMat = 2, Cut = 3, Accent = 4;

        private static readonly Mesh[] Cache = new Mesh[Count];
        private static readonly FruitShader[] Shaders = new FruitShader[Count];

        public static Mesh MeshFor(int kind)
        {
            if (Cache[kind] == null) Cache[kind] = Build(kind);
            return Cache[kind];
        }

        public static FruitShader ShaderFor(int kind)
        {
            if (Shaders[kind] == null) Shaders[kind] = new FruitShader(kind);
            return Shaders[kind];
        }

        public static int Juice(int kind)
        {
            switch (kind)
            {
                case Apple: case Strawberry: case Cherries: case Watermelon: case Pomegranate: case Dragonfruit:
                    return 0xff4a6a;
                case Pear: case Kiwi: case Starfruit:
                    return 0xb8e04a;
                case Orange: case Mango: case Peach: case Papaya:
                    return 0xffa03a;
                case Lemon: case Pineapple:
                    return 0xffe04a;
                default:
                    return 0xb070e0;
            }
        }

        private static void SphereDir(float u, float v, out float x, out float y, out float z)
        {
            float th = u * M.PI, ph = v * M.TAU;
            x = M.Sin(th) * M.Cos(ph);
            y = M.Cos(th);
            z = M.Sin(th) * M.Sin(ph);
        }

        private static float[] N3(float x, float y, float z)
        {
            float l = M.Len(x, y, z); if (l == 0f) l = 1f;
            return new float[] { x / l, y / l, z / l };
        }

        private static float[] V(float x, float y, float z) { return new float[] { x, y, z }; }

        private static void StemAndLeaf(MeshBuilder mb, float top, float lean, float leafSize)
        {
            mb.Tube(new float[][] { V(0f, top - 0.25f, 0f), V(lean * 0.4f, top + 0.08f, 0f), V(lean, top + 0.3f, 0.02f) },
                new float[] { 0.06f, 0.05f, 0.045f }, Stem, 6);
            if (leafSize > 0f)
            {
                mb.Leaf(V(lean * 0.5f, top + 0.12f, 0f), N3(1f, 0.32f, 0.35f), N3(-0.3f, 0.2f, 0.95f), N3(-0.2f, 1f, 0f),
                    leafSize, leafSize * 0.38f, -0.25f, LeafMat);
            }
        }

        private static Mesh Build(int kind)
        {
            MeshBuilder mb = new MeshBuilder();
            const int R = 18, S = 28;
            switch (kind)
            {
                case Apple:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float th = u * M.PI;
                        float widen = 1f + 0.07f * sy;
                        x = sx * widen;
                        y = sy * 0.9f - 0.3f * M.Exp(-(th * th) / 0.07f) + 0.13f * M.Exp(-((M.PI - th) * (M.PI - th)) / 0.06f);
                        z = sz * widen;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    StemAndLeaf(mb, 0.82f, 0.12f, 0.55f);
                    break;
                case Pear:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float sc = 0.5f + 0.5f * M.Smoothstep(0.75f, -0.45f, sy);
                        x = sx * sc * 0.95f; y = sy * 1.18f - 0.08f; z = sz * sc * 0.95f;
                    }, Skin, 0f, -0.2f, 0f, false, 0f, 0);
                    StemAndLeaf(mb, 1.2f, 0.18f, 0.5f);
                    break;
                case Orange:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        SphereDir(u, v, out x, out y, out z); y *= 0.94f;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Ellipsoid(0f, 0.93f, 0f, 0.12f, 0.05f, 0.12f, Stem, 6, 10);
                    mb.Leaf(V(0.05f, 0.95f, 0f), N3(1f, 0.4f, 0.2f), N3(-0.2f, 0.1f, 1f), N3(-0.3f, 1f, 0f), 0.6f, 0.22f, -0.2f, LeafMat);
                    break;
                case Lemon:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float tip = 1f + 0.2f * M.Pow(Math.Abs(sy), 10f);
                        x = sx * 0.74f; y = sy * 1.08f * tip; z = sz * 0.74f;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Leaf(V(0f, 1.22f, 0f), N3(0.9f, 0.5f, 0.1f), N3(0f, 0.1f, 1f), N3(-0.4f, 1f, 0f), 0.62f, 0.22f, -0.2f, LeafMat);
                    break;
                case Strawberry:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float sc = (0.36f + 0.64f * M.Smoothstep(-1.05f, 0.35f, sy)) * (1f - 0.1f * M.Smoothstep(0.55f, 1f, sy));
                        x = sx * sc; y = sy * 1.08f; z = sz * sc;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    for (int i = 0; i < 6; i++)
                    {
                        float a = i / 6f * M.TAU + 0.3f;
                        float[] d = N3(M.Cos(a), -0.25f, M.Sin(a));
                        float[] side = N3(-M.Sin(a), 0f, M.Cos(a));
                        mb.Leaf(V(d[0] * 0.12f, 0.92f, d[2] * 0.12f), d, side, V(0f, 1f, 0f), 0.55f, 0.17f, 0.25f, LeafMat);
                    }
                    mb.Tube(new float[][] { V(0f, 0.9f, 0f), V(0.04f, 1.15f, 0f), V(0.1f, 1.3f, 0f) }, new float[] { 0.05f, 0.045f, 0.04f }, Stem, 6);
                    break;
                case Cherries:
                    mb.Ellipsoid(-0.44f, -0.42f, 0.14f, 0.56f, 0.54f, 0.56f, Skin, 14, 20);
                    mb.Ellipsoid(0.47f, -0.52f, -0.16f, 0.54f, 0.52f, 0.54f, Skin, 14, 20);
                    mb.Tube(new float[][] { V(-0.42f, 0.08f, 0.12f), V(-0.32f, 0.55f, 0.08f), V(0f, 0.92f, 0.02f), V(0.14f, 1.06f, 0f) },
                        new float[] { 0.045f, 0.04f, 0.037f, 0.035f }, Stem, 6);
                    mb.Tube(new float[][] { V(0.46f, -0.02f, -0.15f), V(0.36f, 0.5f, -0.08f), V(0.2f, 0.9f, -0.02f), V(0.14f, 1.06f, 0f) },
                        new float[] { 0.045f, 0.04f, 0.037f, 0.035f }, Stem, 6);
                    mb.Leaf(V(0.14f, 1.06f, 0f), N3(1f, 0.25f, 0.3f), N3(-0.25f, 0.15f, 1f), N3(-0.2f, 1f, 0f), 0.62f, 0.24f, -0.25f, LeafMat);
                    break;
                case Watermelon:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        SphereDir(u, v, out x, out y, out z); x *= 0.98f; y *= 0.92f; z *= 0.98f;
                    }, Skin, 0f, 0f, 0f, true, 0.12f, Cut);
                    break;
                case Pineapple:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        SphereDir(u, v, out x, out y, out z); x *= 0.72f; y = y * 0.98f - 0.12f; z *= 0.72f;
                    }, Skin, 0f, -0.12f, 0f, false, 0f, 0);
                    for (int i = 0; i < 9; i++)
                    {
                        float a = i / 9f * M.TAU;
                        float tilt = i % 2 == 0 ? 0.35f : 0.65f;
                        float[] d = N3(M.Cos(a) * tilt, 1f, M.Sin(a) * tilt);
                        float[] side = N3(-M.Sin(a), 0f, M.Cos(a));
                        mb.Leaf(V(M.Cos(a) * 0.1f, 0.78f, M.Sin(a) * 0.1f), d, side, N3(M.Cos(a), 0.2f, M.Sin(a)), i % 2 == 0 ? 0.95f : 0.7f, 0.13f, 0.18f, LeafMat);
                    }
                    break;
                case Mango:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float bend = 0.2f * sy * sy - 0.08f;
                        float beak = 0.12f * M.Exp(-((sy + 1f) * (sy + 1f)) / 0.05f);
                        x = sx * 0.8f + bend + beak; y = sy * 1.02f; z = sz * 0.66f;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Tube(new float[][] { V(0.1f, 0.9f, 0f), V(0.14f, 1.12f, 0f) }, new float[] { 0.05f, 0.045f }, Stem, 6);
                    break;
                case Kiwi:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        SphereDir(u, v, out x, out y, out z); x *= 0.86f; z *= 0.86f;
                    }, Skin, 0f, 0f, 0f, true, 0.1f, Cut);
                    break;
                case Dragonfruit:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        SphereDir(u, v, out x, out y, out z); x *= 0.8f; z *= 0.8f;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    for (int i = 0; i < 11; i++)
                    {
                        float a = i * 2.4f;
                        float yy = -0.7f + i / 10f * 1.55f;
                        float rr = M.Sqrt(Math.Max(0.04f, 1f - yy * yy)) * 0.8f;
                        float[] o = N3(M.Cos(a), 0f, M.Sin(a));
                        float[] d = N3(M.Cos(a) * 0.55f, 1f, M.Sin(a) * 0.55f);
                        float[] side = N3(-M.Sin(a), 0f, M.Cos(a));
                        mb.Leaf(V(o[0] * rr * 0.93f, yy, o[2] * rr * 0.93f), d, side, o, 0.42f, 0.16f, 0.45f, Accent);
                    }
                    break;
                case Grapes:
                {
                    float[][] rows = new float[][]
                    {
                        new float[] { 0.5f, 4f, 0.42f, 0f },
                        new float[] { 0.12f, 4f, 0.36f, 0.78f },
                        new float[] { -0.26f, 3f, 0.27f, 0.3f },
                        new float[] { -0.6f, 2f, 0.16f, 1.2f },
                        new float[] { -0.88f, 1f, 0f, 0f }
                    };
                    for (int r = 0; r < rows.Length; r++)
                    {
                        float[] row = rows[r];
                        for (int i = 0; i < (int)row[1]; i++)
                        {
                            float a = row[3] + i / row[1] * M.TAU;
                            mb.Ellipsoid(M.Cos(a) * row[2], row[0], M.Sin(a) * row[2], 0.3f, 0.31f, 0.3f, Skin, 10, 14);
                        }
                    }
                    mb.Tube(new float[][] { V(0f, 0.6f, 0f), V(0.03f, 0.95f, 0f), V(0.12f, 1.2f, 0f) }, new float[] { 0.05f, 0.045f, 0.04f }, Stem, 6);
                    mb.Leaf(V(0.06f, 1.0f, 0f), N3(1f, 0.35f, 0.3f), N3(-0.3f, 0.1f, 1f), N3(-0.2f, 1f, 0f), 0.75f, 0.36f, -0.25f, LeafMat);
                    break;
                }
                case Peach:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float crease = 1f - 0.08f * M.Exp(-((sx / 0.14f) * (sx / 0.14f))) * M.Smoothstep(-0.1f, 0.5f, sz);
                        float th = u * M.PI;
                        float dip = -0.12f * M.Exp(-(th * th) / 0.08f);
                        x = sx * crease; y = sy * 0.96f * crease + dip; z = sz * crease;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    StemAndLeaf(mb, 0.86f, 0.06f, 0.6f);
                    break;
                case Plum:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float crease = 1f - 0.04f * M.Exp(-((sx / 0.12f) * (sx / 0.12f))) * M.Smoothstep(0f, 0.6f, sz);
                        x = sx * 0.92f * crease; y = sy; z = sz * 0.9f;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Tube(new float[][] { V(0f, 0.85f, 0f), V(0.04f, 1.08f, 0f), V(0.1f, 1.2f, 0f) }, new float[] { 0.04f, 0.035f, 0.03f }, Stem, 6);
                    break;
                case Pomegranate:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float hex = 1f + 0.035f * M.Cos(v * M.PI * 12f);
                        x = sx * 0.96f * hex; y = sy * 0.9f; z = sz * 0.96f * hex;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Tube(new float[][] { V(0f, 0.75f, 0f), V(0f, 1.0f, 0f) }, new float[] { 0.2f, 0.17f }, Accent, 10);
                    for (int i = 0; i < 6; i++)
                    {
                        float a = i / 6f * M.TAU;
                        float[] d = N3(M.Cos(a) * 0.5f, 1f, M.Sin(a) * 0.5f);
                        float[] side = N3(-M.Sin(a), 0f, M.Cos(a));
                        mb.Leaf(V(M.Cos(a) * 0.15f, 0.98f, M.Sin(a) * 0.15f), d, side, N3(M.Cos(a), 0f, M.Sin(a)), 0.28f, 0.1f, 0.4f, Accent);
                    }
                    break;
                case Fig:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float sc = 0.42f + 0.58f * M.Smoothstep(0.8f, -0.4f, sy);
                        x = sx * sc * 0.92f; y = sy * 1.12f; z = sz * sc * 0.92f;
                    }, Skin, 0f, -0.2f, 0f, false, 0f, 0);
                    mb.Tube(new float[][] { V(0f, 1.0f, 0f), V(0.05f, 1.22f, 0f), V(0.12f, 1.3f, 0f) }, new float[] { 0.06f, 0.05f, 0.04f }, Stem, 6);
                    break;
                case Papaya:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float sc = 0.82f + 0.18f * M.Smoothstep(0.6f, -0.5f, sy);
                        x = sx * 0.7f * sc; y = sy * 1.08f; z = sz * 0.7f * sc;
                    }, Skin, 0f, 0f, 0f, true, 0.05f, Cut);
                    break;
                case Starfruit:
                    mb.Surface(R + 4, 40, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float th = u * M.PI, ph = v * M.TAU;
                        float prof = M.Pow(M.Sin(th), 0.62f);
                        float star = 0.5f + 0.42f * M.Pow(0.5f + 0.5f * M.Cos(5f * ph), 1.3f);
                        x = M.Cos(ph) * star * prof; y = M.Cos(th) * 1.08f; z = M.Sin(ph) * star * prof;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Tube(new float[][] { V(0f, 1.0f, 0f), V(0.04f, 1.18f, 0f) }, new float[] { 0.05f, 0.04f }, Stem, 6);
                    break;
                case Blueberries:
                    mb.Ellipsoid(-0.46f, -0.24f, 0.12f, 0.5f, 0.47f, 0.5f, Skin, 12, 18);
                    mb.Ellipsoid(0.45f, -0.3f, -0.12f, 0.48f, 0.45f, 0.48f, Skin, 12, 18);
                    mb.Ellipsoid(0f, 0.42f, 0f, 0.5f, 0.47f, 0.5f, Skin, 12, 18);
                    mb.Leaf(V(0.1f, 0.85f, 0f), N3(1f, 0.4f, 0.3f), N3(-0.3f, 0.1f, 1f), N3(-0.2f, 1f, 0f), 0.55f, 0.2f, -0.2f, LeafMat);
                    break;
                default:
                    mb.Surface(R, S, delegate(float u, float v, out float x, out float y, out float z)
                    {
                        float sx, sy, sz; SphereDir(u, v, out sx, out sy, out sz);
                        float w = 1f + 0.03f * (M.ValueNoise3(sx * 3f + 5f, sy * 3f, sz * 3f) - 0.5f);
                        x = sx * 0.97f * w; y = sy * 0.94f * w; z = sz * 0.97f * w;
                    }, Skin, 0f, 0f, 0f, false, 0f, 0);
                    mb.Tube(new float[][] { V(0f, 0.85f, 0f), V(0.06f, 1.1f, 0f), V(0.14f, 1.22f, 0f) }, new float[] { 0.05f, 0.045f, 0.04f }, Stem, 6);
                    break;
            }
            return mb.Build();
        }
    }

    internal sealed class FruitShader : IFragmentShader
    {
        private readonly int _kind;
        private float _gloss;
        private float _fuzz;
        private static readonly float[][] BerryCentres = new float[][]
        {
            new float[] { -0.46f, -0.24f, 0.12f }, new float[] { 0.45f, -0.3f, -0.12f }, new float[] { 0f, 0.42f, 0f }
        };

        public FruitShader(int kind) { _kind = kind; }

        public int Shade(int mat, float ox, float oy, float oz, float nx, float ny, float nz, float sx, float sy)
        {
            int albedo;
            float gloss = 0f, fuzz = 0f;
            if (mat == FruitModels.Stem)
            {
                albedo = _kind == FruitModels.Cherries ? 0x5a8a2a : 0x6b3a1e;
            }
            else if (mat == FruitModels.LeafMat)
            {
                albedo = 0x37b24a;
                gloss = 0.3f;
            }
            else if (mat == FruitModels.Accent)
            {
                if (_kind == FruitModels.Dragonfruit)
                    albedo = M.Mix(0xe8287a, 0x8ad43a, M.Smoothstep(-0.2f, 0.9f, oy * 0.3f + (M.Sqrt(ox * ox + oz * oz) - 0.6f) * 1.4f));
                else
                    albedo = 0x9a1e24;
                gloss = 0.2f;
            }
            else
            {
                albedo = SkinColor(mat, ox, oy, oz);
                gloss = _gloss;
                fuzz = _fuzz;
            }
            return Toon.Shade(albedo, nx, ny, nz, sx, sy, gloss, fuzz);
        }

        private int Ret(int c, float gloss, float fuzz) { _gloss = gloss; _fuzz = fuzz; return c; }

        private int SkinColor(int mat, float ox, float oy, float oz)
        {
            switch (_kind)
            {
                case FruitModels.Apple:
                {
                    float streak = M.ValueNoise3(ox * 2.5f, oy * 9f, oz * 2.5f);
                    float yellow = M.Smoothstep(0.25f, -0.9f, oy + (M.ValueNoise3(ox * 2f, oy * 2f, oz * 2f) - 0.5f) * 0.8f);
                    int c = M.Mix(0xd81e2c, 0xb0101e, streak);
                    return Ret(M.Mix(c, 0xf2c83a, yellow * 0.75f), 1f, 0f);
                }
                case FruitModels.Pear:
                {
                    float blush = M.Smoothstep(0.1f, 0.9f, ox * 0.8f + oz * 0.3f + (M.ValueNoise3(ox * 2f, oy * 2f, oz * 2f) - 0.5f));
                    int c = M.Mix(0xd0d84a, 0xe8723a, blush * 0.7f);
                    if (M.Hash2((int)Math.Floor((ox + 2f) * 14f), (int)Math.Floor((oy + 2f) * 14f + oz * 9f)) > 0.93f) c = M.Mix(c, 0x8a6a2a, 0.6f);
                    return Ret(c, 0.5f, 0f);
                }
                case FruitModels.Orange:
                {
                    float pore = M.ValueNoise3(ox * 14f, oy * 14f, oz * 14f);
                    return Ret(M.Mix(0xff8c1a, 0xe86a10, pore > 0.72f ? 0.7f : 0f), 0.6f, 0f);
                }
                case FruitModels.Lemon:
                {
                    float pore = M.ValueNoise3(ox * 14f, oy * 14f, oz * 14f);
                    return Ret(M.Mix(0xffe03a, 0xe8b820, pore > 0.74f ? 0.7f : 0f), 0.6f, 0f);
                }
                case FruitModels.Strawberry:
                {
                    float l = M.Len(ox, oy, oz); if (l == 0f) l = 1f;
                    float th = (float)Math.Acos(Math.Max(-1f, Math.Min(1f, oy / l)));
                    float ph = M.Atan2(oz, ox);
                    const int rows = 9;
                    int ri = (int)Math.Floor(th / M.PI * rows);
                    int cols = Math.Max(3, (int)Math.Round(16f * M.Sin((ri + 0.5f) / rows * M.PI)));
                    float off = (ri % 2) * 0.5f;
                    float cf = M.Fract((ph / M.TAU + 1f) * cols + off);
                    float rf = M.Fract(th / M.PI * rows);
                    float d = M.Sqrt((cf - 0.5f) * 1.3f * (cf - 0.5f) * 1.3f + (rf - 0.5f) * (rf - 0.5f));
                    int c = 0xe8203a;
                    if (th > 0.45f)
                    {
                        if (d < 0.13f) c = 0xffe08a;
                        else if (d < 0.22f) c = 0xa8102a;
                    }
                    if (oy > 0.78f) c = M.Mix(c, 0xf06a4a, 0.4f);
                    return Ret(c, 0.8f, 0f);
                }
                case FruitModels.Cherries:
                    return Ret(M.Mix(0xb0102a, 0x6a0618, M.Smoothstep(0.2f, -0.6f, oy)), 1f, 0f);
                case FruitModels.Watermelon:
                {
                    if (mat == FruitModels.Cut)
                    {
                        float rr = M.Sqrt(ox * ox + oy * oy);
                        if (rr > 0.9f) return Ret(0x2e8a3a, 0.2f, 0f);
                        if (rr > 0.8f) return Ret(0xe8f8c8, 0.2f, 0f);
                        int gx = (int)Math.Floor((ox + 2f) * 5.5f), gy = (int)Math.Floor((oy + 2f) * 4.2f);
                        float h = M.Hash2(gx, gy);
                        float cx = (gx + 0.5f) / 5.5f - 2f, cy = (gy + 0.5f) / 4.2f - 2f;
                        float ex = (ox - cx) / 0.045f, ey = (oy - cy) / 0.075f;
                        bool seed = h > 0.45f && rr < 0.66f && ex * ex + ey * ey < 1f;
                        return Ret(seed ? 0x1a1414 : 0xff3a52, seed ? 1f : 0.35f, 0f);
                    }
                    float ph = M.Atan2(oz, ox);
                    float stripe = M.Sin(ph * 9f + M.Sin(oy * 7f) * 0.7f + (M.ValueNoise3(ox * 3f, oy * 3f, oz * 3f) - 0.5f) * 1.6f);
                    return Ret(stripe > 0.1f ? 0x1e6b2a : 0x7fcf5a, 0.4f, 0f);
                }
                case FruitModels.Pineapple:
                {
                    float ph = M.Atan2(oz, ox) / M.TAU;
                    float a = ph * 9f + oy * 2.4f, b = ph * 9f - oy * 2.4f;
                    float fa = M.Fract(a), fb = M.Fract(b);
                    float edge = Math.Min(Math.Min(fa, 1f - fa), Math.Min(fb, 1f - fb));
                    bool eye = M.Sqrt((fa - 0.5f) * (fa - 0.5f) + (fb - 0.5f) * (fb - 0.5f)) < 0.12f;
                    int c = M.Mix(0xf2b630, 0xb8b03a, M.Smoothstep(-0.2f, -1.0f, oy));
                    if (edge < 0.09f) c = 0x8a5a1c;
                    else if (eye) c = 0x6a4a1a;
                    return Ret(c, 0.3f, 0f);
                }
                case FruitModels.Mango:
                {
                    float t = M.Clamp01(0.5f + oy * 0.45f - ox * 0.25f + (M.ValueNoise3(ox * 2f, oy * 2f, oz * 2f) - 0.5f) * 0.3f);
                    int c;
                    if (t > 0.72f) c = M.Mix(0xff9a1f, 0xf2452a, (t - 0.72f) / 0.28f);
                    else if (t > 0.38f) c = M.Mix(0xffd23f, 0xff9a1f, (t - 0.38f) / 0.34f);
                    else c = M.Mix(0x8acb3a, 0xffd23f, t / 0.38f);
                    return Ret(c, 0.5f, 0f);
                }
                case FruitModels.Kiwi:
                {
                    if (mat == FruitModels.Cut)
                    {
                        float rr = M.Sqrt((ox / 0.86f) * (ox / 0.86f) + oy * oy);
                        if (rr > 0.93f) return Ret(0x8a5a2a, 0f, 0.6f);
                        if (rr < 0.2f) return Ret(0xf5f2c8, 0.2f, 0f);
                        float ang = M.Atan2(oy, ox);
                        if (rr > 0.24f && rr < 0.38f)
                        {
                            float kk = (ang / M.TAU + 1f) * 26f;
                            int k = (int)Math.Floor(kk);
                            float fr = kk - k;
                            if (Math.Abs(fr - 0.5f) < 0.22f && Math.Abs(rr - 0.31f - (M.Hash2(k, 7) - 0.5f) * 0.06f) < 0.035f) return Ret(0x141010, 1f, 0f);
                        }
                        float ray01 = M.Fract((ang / M.TAU + 1f) * 34f);
                        int c = M.Mix(0x8ad42a, 0x5aa81e, M.Smoothstep(0.5f, 0.92f, rr));
                        if (ray01 < 0.12f && rr > 0.38f) c = M.Mix(c, 0xd8f08a, 0.5f);
                        return Ret(c, 0.45f, 0f);
                    }
                    bool sp = M.Hash2((int)Math.Floor((ox + 2f) * 22f), (int)Math.Floor((oy + 2f) * 22f + oz * 13f)) > 0.8f;
                    return Ret(sp ? 0x6a421e : 0x9a6a36, 0f, 1f);
                }
                case FruitModels.Dragonfruit:
                    return Ret(M.Mix(0xf0308a, 0xc81866, M.ValueNoise3(ox * 3f, oy * 3f, oz * 3f)), 0.5f, 0f);
                case FruitModels.Grapes:
                    return Ret(M.Mix(0x5a2a8a, 0x8a6ab8, M.ValueNoise3(ox * 6f, oy * 6f, oz * 6f) * 0.45f), 0.7f, 0f);
                case FruitModels.Peach:
                {
                    float t = M.Clamp01(0.55f + ox * 0.4f + oy * 0.25f + (M.ValueNoise3(ox * 2.5f, oy * 2.5f, oz * 2.5f) - 0.5f) * 0.5f);
                    int c = t > 0.55f ? M.Mix(0xffa04a, 0xe8403a, (t - 0.55f) / 0.45f) : M.Mix(0xffd27a, 0xffa04a, t / 0.55f);
                    return Ret(c, 0.12f, 1f);
                }
                case FruitModels.Plum:
                    return Ret(M.Mix(0x4a1e6a, 0x7a5aa0, M.ValueNoise3(ox * 4f, oy * 4f, oz * 4f) * 0.5f), 0.7f, 0f);
                case FruitModels.Pomegranate:
                    return Ret(M.Mix(0xd02030, 0x8a1420, M.Smoothstep(0.45f, 0.8f, M.ValueNoise3(ox * 3f, oy * 3f, oz * 3f))), 0.5f, 0f);
                case FruitModels.Fig:
                    return Ret(M.Mix(0x4a1e4a, 0x6a8a3a, M.Smoothstep(0.2f, 1.0f, oy) * 0.8f), 0.3f, 0.3f);
                case FruitModels.Papaya:
                {
                    if (mat == FruitModels.Cut)
                    {
                        float rr = M.Sqrt((ox / 0.7f) * (ox / 0.7f) + (oy / 1.08f) * (oy / 1.08f));
                        if (rr > 0.94f) return Ret(0x8ab83a, 0.2f, 0f);
                        float cav = (ox / 0.26f) * (ox / 0.26f) + ((oy + 0.05f) / 0.55f) * ((oy + 0.05f) / 0.55f);
                        if (cav < 1f)
                        {
                            float h = M.Hash2((int)Math.Floor((ox + 2f) * 14f), (int)Math.Floor((oy + 2f) * 14f));
                            return Ret(h > 0.35f ? 0x1a1414 : 0x5a2a1a, 1f, 0f);
                        }
                        return Ret(M.Mix(0xff7a3a, 0xffa04a, M.Smoothstep(0.3f, 0.9f, rr)), 0.35f, 0f);
                    }
                    float t = M.Smoothstep(-0.8f, 0.8f, oy + (M.ValueNoise3(ox * 3f, oy * 3f, oz * 3f) - 0.5f) * 0.6f);
                    return Ret(M.Mix(0xffb83a, 0x6aa83a, t), 0.4f, 0f);
                }
                case FruitModels.Starfruit:
                {
                    float ph = M.Atan2(oz, ox);
                    float rib = M.Pow(0.5f + 0.5f * M.Cos(5f * ph), 6f);
                    return Ret(M.Mix(0xffd63a, 0xc8e04a, rib * 0.8f), 0.8f, 0f);
                }
                case FruitModels.Blueberries:
                {
                    int best = 0;
                    float bd = 1e9f;
                    for (int i = 0; i < 3; i++)
                    {
                        float[] c0 = BerryCentres[i];
                        float d = (ox - c0[0]) * (ox - c0[0]) + (oy - c0[1]) * (oy - c0[1]) + (oz - c0[2]) * (oz - c0[2]);
                        if (d < bd) { bd = d; best = i; }
                    }
                    float[] cc = BerryCentres[best];
                    float dx = ox - cc[0], dy = oy - cc[1], dz = oz - cc[2];
                    float l = M.Len(dx, dy, dz); if (l == 0f) l = 1f;
                    float cl = M.Len(cc[0], cc[1] + 0.05f, cc[2] + 0.4f); if (cl == 0f) cl = 1f;
                    float cosA = (dx * cc[0] / cl + dy * (cc[1] + 0.05f) / cl + dz * (cc[2] + 0.4f) / cl) / l;
                    int c = M.Mix(0x3a4ab8, 0x8a9ad8, M.ValueNoise3(ox * 5f, oy * 5f, oz * 5f) * 0.45f);
                    if (cosA > 0.93f) c = 0x1e2050;
                    else if (cosA > 0.88f) c = 0x2a3270;
                    return Ret(c, 0.45f, 0f);
                }
                default:
                {
                    bool sp = M.Hash2((int)Math.Floor((ox + 2f) * 18f), (int)Math.Floor((oy + 2f) * 18f + oz * 11f)) > 0.86f;
                    float wr = M.ValueNoise3(ox * 5f, oy * 5f, oz * 5f);
                    int c = M.Mix(0x5a1e5a, 0x3a1040, M.Smoothstep(0.55f, 0.75f, wr));
                    if (sp) c = M.Mix(c, 0xd8b0d8, 0.6f);
                    return Ret(c, 0.4f, 0f);
                }
            }
        }
    }
}
