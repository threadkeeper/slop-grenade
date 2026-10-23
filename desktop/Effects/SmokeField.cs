// SmokeField.cs
// Real-time smoke on a coarse "stable fluids" grid: semi-Lagrangian advection,
// pressure projection, vorticity confinement and buoyancy. Moving objects stir
// the velocity field so plumes swirl around them. Rendered at 3x grid
// resolution with self-shadowing and drifting wisp noise.
// Mirrors web/src/lib/engine/smoke.ts.

using System;

namespace SlopGrenadeDesktop
{
    internal sealed class SmokeField : IDisposable
    {
        public readonly int Nx, Ny, ViewW, ViewH;
        public readonly float Cell;
        private readonly int _n;
        private readonly float[] _u, _v, _u0, _v0, _d, _d0, _c, _c0, _curl, _p, _div;
        public readonly PixelSprite Sprite;
        public const int Scale = 3;
        private float _time;
        public float Mass;
        private int _gi0, _gj0, _gi1 = -1, _gj1 = -1;
        private int _px0, _py0, _px1 = -1, _py1 = -1;
        /// <summary>Visible bounds in render pixels (inclusive); Bx1 &lt; Bx0 when empty.</summary>
        public int Bx0, By0, Bx1 = -1, By1 = -1;

        public SmokeField(int viewW, int viewH, int rows)
        {
            ViewW = viewW;
            ViewH = viewH;
            Ny = rows;
            Cell = (float)viewH / rows;
            Nx = Math.Max(8, (int)Math.Ceiling(viewW / Cell));
            _n = (Nx + 2) * (Ny + 2);
            _u = new float[_n]; _v = new float[_n]; _u0 = new float[_n]; _v0 = new float[_n];
            _d = new float[_n]; _d0 = new float[_n]; _c = new float[_n]; _c0 = new float[_n];
            _curl = new float[_n]; _p = new float[_n]; _div = new float[_n];
            Sprite = new PixelSprite(Nx * Scale, Ny * Scale);
        }

        public bool IsEmpty { get { return Mass < 0.02f || _gi1 < 0; } }

        private int Ix(int i, int j) { return i + (Nx + 2) * j; }

        public void Puff(float x, float y, float radius, float amount, float vx, float vy, float soot)
        {
            float cs = Cell;
            float gx = x / cs, gy = y / cs, gr = Math.Max(0.6f, radius / cs);
            int i0 = Math.Max(1, (int)Math.Floor(gx - gr * 2f)), i1 = Math.Min(Nx, (int)Math.Ceiling(gx + gr * 2f));
            int j0 = Math.Max(1, (int)Math.Floor(gy - gr * 2f)), j1 = Math.Min(Ny, (int)Math.Ceiling(gy + gr * 2f));
            float inv = 1f / (gr * gr);
            for (int j = j0; j <= j1; j++)
            {
                for (int i = i0; i <= i1; i++)
                {
                    float dx = i - 0.5f - gx, dy = j - 0.5f - gy;
                    float w = M.Exp(-(dx * dx + dy * dy) * inv);
                    if (w < 0.01f) continue;
                    int k = Ix(i, j);
                    float add = amount * w;
                    _d[k] += add;
                    _c[k] += add * soot;
                    _u[k] += vx / cs * w;
                    _v[k] += vy / cs * w;
                }
            }
            if (i0 < _gi0) _gi0 = i0;
            if (i1 > _gi1) _gi1 = i1;
            if (j0 < _gj0) _gj0 = j0;
            if (j1 > _gj1) _gj1 = j1;
            Mass += amount;
        }

        public void Stir(float x, float y, float radius, float vx, float vy, float strength)
        {
            if (IsEmpty) return;
            float cs = Cell;
            float gx = x / cs, gy = y / cs, gr = Math.Max(0.8f, radius / cs);
            int i0 = Math.Max(1, (int)Math.Floor(gx - gr * 1.6f)), i1 = Math.Min(Nx, (int)Math.Ceiling(gx + gr * 1.6f));
            int j0 = Math.Max(1, (int)Math.Floor(gy - gr * 1.6f)), j1 = Math.Min(Ny, (int)Math.Ceiling(gy + gr * 1.6f));
            float inv = 1f / (gr * gr);
            for (int j = j0; j <= j1; j++)
            {
                for (int i = i0; i <= i1; i++)
                {
                    float dx = i - 0.5f - gx, dy = j - 0.5f - gy;
                    float w = M.Exp(-(dx * dx + dy * dy) * inv) * strength;
                    if (w < 0.01f) continue;
                    int k = Ix(i, j);
                    float m = Math.Min(1f, w);
                    _u[k] += (vx / cs - _u[k]) * m;
                    _v[k] += (vy / cs - _v[k]) * m;
                }
            }
        }

        public void Step(float dt)
        {
            if (IsEmpty) { Bx1 = -1; return; }
            _time += dt;
            int N = Nx, Mr = Ny, W = N + 2;
            for (int j = 1; j <= Mr; j++)
                for (int i = 1; i <= N; i++)
                {
                    int k = i + W * j;
                    _v[k] -= _d[k] * 1.9f * dt;
                }
            Vorticity(dt, 2.2f);
            Array.Copy(_u, _u0, _n);
            Array.Copy(_v, _v0, _n);
            Advect(_u, _u0, _u0, _v0, dt);
            Advect(_v, _v0, _u0, _v0, dt);
            Bound();
            Project(14);
            Array.Copy(_d, _d0, _n);
            Array.Copy(_c, _c0, _n);
            Advect(_d, _d0, _u, _v, dt);
            Advect(_c, _c0, _u, _v, dt);
            float topK = M.Exp(-6f * dt);
            for (int j = 1; j <= 3; j++)
                for (int i = 1; i <= N; i++)
                {
                    int k = i + W * j;
                    _d[k] *= topK;
                    _c[k] *= topK;
                }
            float dk = M.Exp(-0.14f * dt), vk = M.Exp(-0.55f * dt);
            // exponential fade plus slow evaporation so faint haze clears for good
            float evap = 0.012f * dt;
            float mass = 0f;
            int gi0 = N + 1, gj0 = Mr + 1, gi1 = -1, gj1 = -1;
            for (int j = 0; j <= Mr + 1; j++)
            {
                for (int i = 0; i <= N + 1; i++)
                {
                    int k = i + W * j;
                    _d[k] = _d[k] * dk - evap; _c[k] *= dk; _u[k] *= vk; _v[k] *= vk;
                    if (_d[k] < 1e-4f) { _d[k] = 0f; _c[k] = 0f; continue; }
                    mass += _d[k];
                    if (_d[k] > 0.003f)
                    {
                        if (i < gi0) gi0 = i;
                        if (i > gi1) gi1 = i;
                        if (j < gj0) gj0 = j;
                        if (j > gj1) gj1 = j;
                    }
                }
            }
            Mass = mass;
            _gi0 = gi0; _gj0 = gj0; _gi1 = gi1; _gj1 = gj1;
        }

        private void Bound()
        {
            int N = Nx, Mr = Ny, W = N + 2;
            for (int i = 1; i <= N; i++) { _v[i] = 0f; _v[i + W * (Mr + 1)] = 0f; }
            for (int j = 1; j <= Mr; j++) { _u[W * j] = 0f; _u[N + 1 + W * j] = 0f; }
        }

        private void Vorticity(float dt, float eps)
        {
            int N = Nx, Mr = Ny, W = N + 2;
            for (int j = 1; j <= Mr; j++)
                for (int i = 1; i <= N; i++)
                {
                    int k = i + W * j;
                    _curl[k] = (_v[k + 1] - _v[k - 1] - (_u[k + W] - _u[k - W])) * 0.5f;
                }
            for (int j = 2; j < Mr; j++)
                for (int i = 2; i < N; i++)
                {
                    int k = i + W * j;
                    float gx = (Math.Abs(_curl[k + 1]) - Math.Abs(_curl[k - 1])) * 0.5f;
                    float gy = (Math.Abs(_curl[k + W]) - Math.Abs(_curl[k - W])) * 0.5f;
                    float l = (float)Math.Sqrt(gx * gx + gy * gy) + 1e-5f;
                    float w = _curl[k];
                    _u[k] += gy / l * w * eps * dt;
                    _v[k] -= gx / l * w * eps * dt;
                }
        }

        private void Advect(float[] dst, float[] src, float[] vu, float[] vv, float dt)
        {
            int N = Nx, Mr = Ny, W = N + 2;
            for (int j = 1; j <= Mr; j++)
            {
                for (int i = 1; i <= N; i++)
                {
                    int k = i + W * j;
                    float x = i - dt * vu[k], y = j - dt * vv[k];
                    if (x < 0.5f) x = 0.5f;
                    if (x > N + 0.5f) x = N + 0.5f;
                    if (y < 0.5f) y = 0.5f;
                    if (y > Mr + 0.5f) y = Mr + 0.5f;
                    int i0 = (int)x, j0 = (int)y;
                    float s1 = x - i0, s0 = 1f - s1, t1 = y - j0, t0 = 1f - t1;
                    int a = i0 + W * j0;
                    dst[k] = s0 * (t0 * src[a] + t1 * src[a + W]) + s1 * (t0 * src[a + 1] + t1 * src[a + 1 + W]);
                }
            }
        }

        private void Project(int iters)
        {
            int N = Nx, Mr = Ny, W = N + 2;
            for (int j = 1; j <= Mr; j++)
                for (int i = 1; i <= N; i++)
                {
                    int k = i + W * j;
                    _div[k] = -0.5f * (_u[k + 1] - _u[k - 1] + _v[k + W] - _v[k - W]);
                    _p[k] = 0f;
                }
            for (int it = 0; it < iters; it++)
                for (int j = 1; j <= Mr; j++)
                    for (int i = 1; i <= N; i++)
                    {
                        int k = i + W * j;
                        _p[k] = (_div[k] + _p[k - 1] + _p[k + 1] + _p[k - W] + _p[k + W]) * 0.25f;
                    }
            for (int j = 1; j <= Mr; j++)
                for (int i = 1; i <= N; i++)
                {
                    int k = i + W * j;
                    _u[k] -= 0.5f * (_p[k + 1] - _p[k - 1]);
                    _v[k] -= 0.5f * (_p[k + W] - _p[k - W]);
                }
            Bound();
        }

        private float Sample(float[] f, float gx, float gy)
        {
            int N = Nx, Mr = Ny, W = N + 2;
            float x = gx + 0.5f, y = gy + 0.5f;
            if (x < 0.5f) x = 0.5f;
            if (y < 0.5f) y = 0.5f;
            if (x > N + 0.5f) x = N + 0.5f;
            if (y > Mr + 0.5f) y = Mr + 0.5f;
            int i0 = (int)x, j0 = (int)y;
            float s1 = x - i0, t1 = y - j0;
            int a = i0 + W * j0;
            return (1f - s1) * ((1f - t1) * f[a] + t1 * f[a + W]) + s1 * ((1f - t1) * f[a + 1] + t1 * f[a + 1 + W]);
        }

        /// <summary>Renders premultiplied pixels into Sprite and updates Bx0..By1.</summary>
        public void Render()
        {
            int rw = Sprite.Width, rh = Sprite.Height;
            int[] P = Sprite.Pixels;
            if (_px1 >= _px0)
            {
                int cx0 = Math.Max(0, _px0), cx1 = Math.Min(rw - 1, _px1);
                for (int y = Math.Max(0, _py0); y <= Math.Min(rh - 1, _py1); y++)
                    Array.Clear(P, y * rw + cx0, cx1 - cx0 + 1);
            }
            _px1 = -1;
            if (IsEmpty || _gi1 < _gi0) { Bx1 = -1; return; }
            const int sc = Scale;
            int rx0 = Math.Max(0, (_gi0 - 2) * sc), rx1 = Math.Min(rw - 1, (_gi1 + 1) * sc);
            int ry0 = Math.Max(0, (_gj0 - 2) * sc), ry1 = Math.Min(rh - 1, (_gj1 + 1) * sc);
            _px0 = rx0; _px1 = rx1; _py0 = ry0; _py1 = ry1;
            int bx0 = rw, by0 = rh, bx1 = -1, by1 = -1;
            float t = _time;
            for (int y = ry0; y <= ry1; y++)
            {
                float gy = (y + 0.5f) / sc;
                for (int x = rx0; x <= rx1; x++)
                {
                    float gx = (x + 0.5f) / sc;
                    float dens = Sample(_d, gx, gy);
                    if (dens < 0.004f) continue;
                    float soot = Math.Min(1f, Sample(_c, gx, gy) / (dens + 1e-6f));
                    float nz = M.ValueNoise2(x * 0.075f + t * 0.3f, y * 0.075f - t * 0.45f) * 0.65f
                        + M.ValueNoise2(x * 0.2f - t * 0.25f, y * 0.2f + t * 0.18f) * 0.35f;
                    float dd = dens * (0.5f + 1.0f * nz);
                    float occ = Sample(_d, gx - 1.0f, gy - 1.4f);
                    float lit = 1.12f - occ * 0.62f;
                    if (dens < 0.4f && occ < dens * 0.5f) lit += 0.18f;
                    lit = M.Clamp01(lit);
                    float alpha = 1f - M.Exp(-dd * 1.9f);
                    float lr = 218f + (190f - 218f) * soot, lg = 226f + (172f - 226f) * soot, lb = 238f + (164f - 238f) * soot;
                    float dr = 88f + (40f - 88f) * soot, dg = 98f + (34f - 98f) * soot, db = 124f + (40f - 124f) * soot;
                    int a = (int)Math.Min(212f, alpha * 230f);
                    if (a <= 2) continue;
                    int r = (int)(dr + (lr - dr) * lit), g = (int)(dg + (lg - dg) * lit), b = (int)(db + (lb - db) * lit);
                    P[y * rw + x] = (a << 24) | ((r * a / 255) << 16) | ((g * a / 255) << 8) | (b * a / 255);
                    if (x < bx0) bx0 = x;
                    if (x > bx1) bx1 = x;
                    if (y < by0) by0 = y;
                    if (y > by1) by1 = y;
                }
            }
            Bx0 = bx0; By0 = by0; Bx1 = bx1; By1 = by1;
        }

        public void Dispose()
        {
            Sprite.Dispose();
        }
    }
}
