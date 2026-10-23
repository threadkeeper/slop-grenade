// Toon3D.cs
// Tiny software 3D "toon" renderer for the tumbling fruit. Mirrors
// web/src/lib/engine/toon3d.ts: 2x supersampled z-buffer rasteriser, deferred
// cel shading, ink outlines (silhouette + material/depth edges), box downsample.

using System;
using System.Collections.Generic;

namespace SlopGrenadeDesktop
{
    internal interface IFragmentShader
    {
        int Shade(int mat, float ox, float oy, float oz, float nx, float ny, float nz, float sx, float sy);
    }

    internal sealed class Mesh
    {
        public int VertexCount;
        public float[] Px, Py, Pz, Nx, Ny, Nz;
        public int TriCount;
        public int[] Idx;
        public byte[] Mat;
        public byte[] TwoSided;
        public float[] Fnx, Fny, Fnz;
    }

    internal delegate void SurfaceFn(float u, float v, out float x, out float y, out float z);

    internal sealed class MeshBuilder
    {
        private readonly List<float> _px = new List<float>();
        private readonly List<float> _py = new List<float>();
        private readonly List<float> _pz = new List<float>();
        private readonly List<float> _hx = new List<float>();
        private readonly List<float> _hy = new List<float>();
        private readonly List<float> _hz = new List<float>();
        private readonly List<int> _idx = new List<int>();
        private readonly List<byte> _mat = new List<byte>();
        private readonly List<byte> _two = new List<byte>();

        public int Vertex(float x, float y, float z, float hx, float hy, float hz)
        {
            _px.Add(x); _py.Add(y); _pz.Add(z);
            _hx.Add(hx); _hy.Add(hy); _hz.Add(hz);
            return _px.Count - 1;
        }

        public void Tri(int a, int b, int c, int mat, bool twoSided)
        {
            _idx.Add(a); _idx.Add(b); _idx.Add(c);
            _mat.Add((byte)mat);
            _two.Add(twoSided ? (byte)1 : (byte)0);
        }

        /// <summary>Closed parametric surface, u pole-to-pole, v around. cutZ clamps (halved fruit).</summary>
        public void Surface(int rings, int segs, SurfaceFn pos, int mat, float cx, float cy, float cz, bool hasCut, float cutZ, int cutMat)
        {
            int start = _px.Count;
            List<bool> clamped = new List<bool>();
            int top = AddClamped(pos, 0f, 0f, cx, cy, cz, hasCut, cutZ, clamped);
            for (int i = 1; i < rings; i++)
            {
                for (int j = 0; j < segs; j++)
                {
                    AddClamped(pos, (float)i / rings, (float)j / segs, cx, cy, cz, hasCut, cutZ, clamped);
                }
            }
            int bottom = AddClamped(pos, 1f, 0f, cx, cy, cz, hasCut, cutZ, clamped);
            for (int j = 0; j < segs; j++)
            {
                int a = top, b = Ring(start, segs, 1, j), c = Ring(start, segs, 1, j + 1);
                Tri(a, b, c, IsCut(clamped, start, a, b, c) ? cutMat : mat, false);
            }
            for (int i = 1; i < rings - 1; i++)
            {
                for (int j = 0; j < segs; j++)
                {
                    int a = Ring(start, segs, i, j);
                    int b = Ring(start, segs, i + 1, j);
                    int c = Ring(start, segs, i + 1, j + 1);
                    int d = Ring(start, segs, i, j + 1);
                    Tri(a, b, c, IsCut(clamped, start, a, b, c) ? cutMat : mat, false);
                    Tri(a, c, d, IsCut(clamped, start, a, c, d) ? cutMat : mat, false);
                }
            }
            for (int j = 0; j < segs; j++)
            {
                int a = Ring(start, segs, rings - 1, j), b = bottom, c = Ring(start, segs, rings - 1, j + 1);
                Tri(a, b, c, IsCut(clamped, start, a, b, c) ? cutMat : mat, false);
            }
        }

        private static int Ring(int start, int segs, int i, int j) { return start + 1 + (i - 1) * segs + (j % segs); }

        private static bool IsCut(List<bool> clamped, int start, int a, int b, int c)
        {
            return clamped[a - start] && clamped[b - start] && clamped[c - start];
        }

        private int AddClamped(SurfaceFn pos, float u, float v, float cx, float cy, float cz, bool hasCut, float cutZ, List<bool> clamped)
        {
            float x, y, z;
            pos(u, v, out x, out y, out z);
            bool c = false;
            if (hasCut && z > cutZ) { z = cutZ; c = true; }
            clamped.Add(c);
            return Vertex(x, y, z, cx, cy, cz);
        }

        public void Ellipsoid(float cx, float cy, float cz, float rx, float ry, float rz, int mat, int rings, int segs)
        {
            Surface(rings, segs, delegate(float u, float v, out float x, out float y, out float z)
            {
                float th = u * M.PI, ph = v * M.TAU;
                x = cx + M.Sin(th) * M.Cos(ph) * rx;
                y = cy + M.Cos(th) * ry;
                z = cz + M.Sin(th) * M.Sin(ph) * rz;
            }, mat, cx, cy, cz, false, 0f, 0);
        }

        /// <summary>Tube along a polyline (points as float[3]) with per-point radius and capped ends.</summary>
        public void Tube(float[][] pts, float[] radii, int mat, int segs)
        {
            int n = pts.Length;
            int[][] rings = new int[n][];
            for (int i = 0; i < n; i++)
            {
                float[] p = pts[i];
                float[] q = pts[Math.Min(n - 1, i + 1)];
                float[] o = pts[Math.Max(0, i - 1)];
                float tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2];
                float tl = M.Len(tx, ty, tz); if (tl == 0f) tl = 1f;
                tx /= tl; ty /= tl; tz /= tl;
                float ax = 0f, ay = 0f, az = 1f;
                if (Math.Abs(tz) > 0.9f) { ax = 1f; az = 0f; }
                float ux = ty * az - tz * ay, uy = tz * ax - tx * az, uz = tx * ay - ty * ax;
                float ul = M.Len(ux, uy, uz); if (ul == 0f) ul = 1f;
                ux /= ul; uy /= ul; uz /= ul;
                float wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
                rings[i] = new int[segs];
                for (int j = 0; j < segs; j++)
                {
                    float a = (float)j / segs * M.TAU;
                    float ca = M.Cos(a) * radii[i], sa = M.Sin(a) * radii[i];
                    rings[i][j] = Vertex(p[0] + ux * ca + wx * sa, p[1] + uy * ca + wy * sa, p[2] + uz * ca + wz * sa, p[0], p[1], p[2]);
                }
            }
            for (int i = 0; i < n - 1; i++)
            {
                for (int j = 0; j < segs; j++)
                {
                    int a = rings[i][j], b = rings[i + 1][j], c = rings[i + 1][(j + 1) % segs], d = rings[i][(j + 1) % segs];
                    Tri(a, b, c, mat, false);
                    Tri(a, c, d, mat, false);
                }
            }
            Cap(pts, radii, rings, 0, -1, mat, segs);
            Cap(pts, radii, rings, n - 1, 1, mat, segs);
        }

        private void Cap(float[][] pts, float[] radii, int[][] rings, int i, int dir, int mat, int segs)
        {
            float[] p = pts[i];
            int qi = i - dir;
            float[] q = (qi >= 0 && qi < pts.Length) ? pts[qi] : pts[i];
            float tx = p[0] - q[0], ty = p[1] - q[1], tz = p[2] - q[2];
            float tl = M.Len(tx, ty, tz); if (tl == 0f) tl = 1f;
            float r = radii[i];
            int tip = Vertex(p[0] + tx / tl * r * 0.8f, p[1] + ty / tl * r * 0.8f, p[2] + tz / tl * r * 0.8f, p[0], p[1], p[2]);
            for (int j = 0; j < segs; j++) Tri(rings[i][j], tip, rings[i][(j + 1) % segs], mat, false);
        }

        /// <summary>Two-sided leaf blade.</summary>
        public void Leaf(float[] bas, float[] dir, float[] side, float[] up, float length, float width, float curl, int mat)
        {
            const int nu = 7, nv = 2;
            int[][] grid = new int[nu + 1][];
            for (int i = 0; i <= nu; i++)
            {
                float u = (float)i / nu;
                float w = width * M.Pow(M.Sin(M.PI * Math.Min(1f, u * 1.05f)), 0.75f);
                grid[i] = new int[nv * 2 + 1];
                for (int j = -nv; j <= nv; j++)
                {
                    float v = (float)j / nv;
                    float bow = curl * length * u * u - Math.Abs(v) * width * 0.25f;
                    float x = bas[0] + dir[0] * u * length + side[0] * v * w + up[0] * bow;
                    float y = bas[1] + dir[1] * u * length + side[1] * v * w + up[1] * bow;
                    float z = bas[2] + dir[2] * u * length + side[2] * v * w + up[2] * bow;
                    grid[i][j + nv] = Vertex(x, y, z, x - up[0], y - up[1], z - up[2]);
                }
            }
            for (int i = 0; i < nu; i++)
            {
                for (int j = 0; j < nv * 2; j++)
                {
                    int a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
                    Tri(a, b, c, mat, true);
                    Tri(a, c, d, mat, true);
                }
            }
        }

        public Mesh Build()
        {
            int vc = _px.Count, tc = _mat.Count;
            Mesh m = new Mesh();
            m.VertexCount = vc;
            m.Px = _px.ToArray(); m.Py = _py.ToArray(); m.Pz = _pz.ToArray();
            m.Nx = new float[vc]; m.Ny = new float[vc]; m.Nz = new float[vc];
            m.TriCount = tc;
            m.Idx = _idx.ToArray();
            m.Mat = _mat.ToArray();
            m.TwoSided = _two.ToArray();
            m.Fnx = new float[tc]; m.Fny = new float[tc]; m.Fnz = new float[tc];
            for (int t = 0; t < tc; t++)
            {
                int a = m.Idx[t * 3], b = m.Idx[t * 3 + 1], c = m.Idx[t * 3 + 2];
                float e1x = m.Px[b] - m.Px[a], e1y = m.Py[b] - m.Py[a], e1z = m.Pz[b] - m.Pz[a];
                float e2x = m.Px[c] - m.Px[a], e2y = m.Py[c] - m.Py[a], e2z = m.Pz[c] - m.Pz[a];
                float fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
                float cx = (m.Px[a] + m.Px[b] + m.Px[c]) / 3f - (_hx[a] + _hx[b] + _hx[c]) / 3f;
                float cy = (m.Py[a] + m.Py[b] + m.Py[c]) / 3f - (_hy[a] + _hy[b] + _hy[c]) / 3f;
                float cz = (m.Pz[a] + m.Pz[b] + m.Pz[c]) / 3f - (_hz[a] + _hz[b] + _hz[c]) / 3f;
                if (fx * cx + fy * cy + fz * cz < 0f) { fx = -fx; fy = -fy; fz = -fz; }
                float fl = M.Len(fx, fy, fz); if (fl == 0f) fl = 1f;
                m.Fnx[t] = fx / fl; m.Fny[t] = fy / fl; m.Fnz[t] = fz / fl;
                m.Nx[a] += fx; m.Ny[a] += fy; m.Nz[a] += fz;
                m.Nx[b] += fx; m.Ny[b] += fy; m.Nz[b] += fz;
                m.Nx[c] += fx; m.Ny[c] += fy; m.Nz[c] += fz;
            }
            for (int v = 0; v < vc; v++)
            {
                float l = M.Len(m.Nx[v], m.Ny[v], m.Nz[v]); if (l == 0f) l = 1f;
                m.Nx[v] /= l; m.Ny[v] /= l; m.Nz[v] /= l;
            }
            return m;
        }
    }

    internal static class Toon
    {
        public static readonly float[] Light;
        private static readonly float[] Half;

        static Toon()
        {
            float lx = -0.48f, ly = 0.62f, lz = 0.62f;
            float l = M.Len(lx, ly, lz);
            Light = new float[] { lx / l, ly / l, lz / l };
            float hx = Light[0], hy = Light[1], hz = Light[2] + 1f;
            float hl = M.Len(hx, hy, hz);
            Half = new float[] { hx / hl, hy / hl, hz / hl };
        }

        /// <summary>Row-major rotation matrix from a unit axis and angle.</summary>
        public static void AxisAngle(float ax, float ay, float az, float angle, float[] o)
        {
            float c = M.Cos(angle), s = M.Sin(angle), t = 1f - c;
            o[0] = t * ax * ax + c; o[1] = t * ax * ay - s * az; o[2] = t * ax * az + s * ay;
            o[3] = t * ax * ay + s * az; o[4] = t * ay * ay + c; o[5] = t * ay * az - s * ax;
            o[6] = t * ax * az - s * ay; o[7] = t * ay * az + s * ax; o[8] = t * az * az + c;
        }

        public static void Mul3(float[] a, float[] b, float[] o)
        {
            float[] r = new float[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
            Array.Copy(r, o, 9);
        }

        /// <summary>Shared cel-shading model (see toonShade in toon3d.ts).</summary>
        public static int Shade(int albedo, float nx, float ny, float nz, float sx, float sy, float gloss, float fuzz)
        {
            float ndl = nx * Light[0] + ny * Light[1] + nz * Light[2];
            int c;
            if (ndl > 0.6f) c = M.Mix(albedo, 0xffffff, 0.22f);
            else if (ndl > 0.02f) c = albedo;
            else if (ndl > -0.42f) c = M.MulRgb(albedo, 0.66f, 0.58f, 0.78f);
            else
            {
                c = M.MulRgb(albedo, 0.46f, 0.4f, 0.6f);
                if (((int)(sx + sy)) % 7 < 2) c = M.Mix(c, Palette.Ink, 0.55f);
            }
            if (fuzz > 0f)
            {
                float rim = 1f - Math.Max(0f, nz);
                if (rim > 0.62f) c = M.Mix(c, M.Mix(albedo, 0xffffff, 0.45f), fuzz * 0.55f);
            }
            if (gloss > 0f)
            {
                float spec = nx * Half[0] + ny * Half[1] + nz * Half[2];
                float edge = 1f - 0.045f * gloss;
                if (spec > edge + 0.018f) c = 0xffffff;
                else if (spec > edge) c = M.Mix(c, 0xffffff, 0.55f);
            }
            return c;
        }
    }

    /// <summary>Re-usable supersampled toon rasteriser producing a premultiplied ARGB sprite.</summary>
    internal sealed class ToonRenderer
    {
        public readonly int Size;
        public readonly int SS;
        public readonly int HS;
        public readonly int[] Out;
        private readonly float[] _depth, _bnx, _bny, _bnz, _box, _boy, _boz;
        private readonly short[] _bmat;
        private readonly byte[] _ink;
        private float[] _vx = new float[0], _vy = new float[0], _vz = new float[0];
        private float[] _wnx = new float[0], _wny = new float[0], _wnz = new float[0];
        private readonly int[] _disk;
        private readonly int _diskR;
        private int _bx0, _by0, _bx1 = -1, _by1 = -1;

        public ToonRenderer(int size, int ss, float outlinePx)
        {
            Size = size;
            SS = ss;
            HS = size * ss;
            int n = HS * HS;
            Out = new int[size * size];
            _depth = new float[n]; _bnx = new float[n]; _bny = new float[n]; _bnz = new float[n];
            _box = new float[n]; _boy = new float[n]; _boz = new float[n];
            _bmat = new short[n];
            _ink = new byte[n];
            float r = outlinePx * ss;
            int ri = (int)Math.Ceiling(r);
            List<int> offs = new List<int>();
            for (int dy = -ri; dy <= ri; dy++)
                for (int dx = -ri; dx <= ri; dx++)
                    if (dx * dx + dy * dy <= r * r) { offs.Add(dx); offs.Add(dy); }
            _disk = offs.ToArray();
            _diskR = ri;
            for (int i = 0; i < n; i++) { _depth[i] = -1e9f; _bmat[i] = -1; }
        }

        public void Render(Mesh mesh, float[] rot, float unitPx, IFragmentShader shader)
        {
            int hs = HS;
            if (_bx1 >= _bx0)
            {
                int m = _diskR + 1;
                int cx0 = Math.Max(0, _bx0 - m), cx1 = Math.Min(hs - 1, _bx1 + m);
                int cy0 = Math.Max(0, _by0 - m), cy1 = Math.Min(hs - 1, _by1 + m);
                for (int y = cy0; y <= cy1; y++)
                {
                    int a = y * hs + cx0, b = y * hs + cx1;
                    for (int i = a; i <= b; i++) { _depth[i] = -1e9f; _bmat[i] = -1; _ink[i] = 0; }
                }
            }
            _bx0 = hs; _by0 = hs; _bx1 = -1; _by1 = -1;
            if (_vx.Length < mesh.VertexCount)
            {
                int vc = mesh.VertexCount;
                _vx = new float[vc]; _vy = new float[vc]; _vz = new float[vc];
                _wnx = new float[vc]; _wny = new float[vc]; _wnz = new float[vc];
            }
            float k = unitPx * SS;
            float c = hs * 0.5f;
            for (int v = 0; v < mesh.VertexCount; v++)
            {
                float x = mesh.Px[v], y = mesh.Py[v], z = mesh.Pz[v];
                _vx[v] = c + (rot[0] * x + rot[1] * y + rot[2] * z) * k;
                _vy[v] = c - (rot[3] * x + rot[4] * y + rot[5] * z) * k;
                _vz[v] = rot[6] * x + rot[7] * y + rot[8] * z;
                float nx = mesh.Nx[v], ny = mesh.Ny[v], nz = mesh.Nz[v];
                _wnx[v] = rot[0] * nx + rot[1] * ny + rot[2] * nz;
                _wny[v] = rot[3] * nx + rot[4] * ny + rot[5] * nz;
                _wnz[v] = rot[6] * nx + rot[7] * ny + rot[8] * nz;
            }
            for (int t = 0; t < mesh.TriCount; t++)
            {
                float fz = rot[6] * mesh.Fnx[t] + rot[7] * mesh.Fny[t] + rot[8] * mesh.Fnz[t];
                if (fz < -0.02f && mesh.TwoSided[t] == 0) continue;
                Raster(mesh, mesh.Idx[t * 3], mesh.Idx[t * 3 + 1], mesh.Idx[t * 3 + 2], mesh.Mat[t]);
            }
            int lx0 = _bx0, lx1 = _bx1, ly0 = _by0, ly1 = _by1;
            // internal ink lines
            const float dzTh = 0.12f;
            for (int y = ly0; y <= ly1; y++)
            {
                for (int x = lx0; x <= lx1; x++)
                {
                    int i = y * hs + x;
                    int mm = _bmat[i];
                    if (mm < 0) continue;
                    float z = _depth[i];
                    bool edge = false;
                    if (x + 1 < hs)
                    {
                        int mj = _bmat[i + 1];
                        if (mj >= 0 && (mj != mm || Math.Abs(_depth[i + 1] - z) > dzTh)) edge = true;
                    }
                    if (!edge && y + 1 < hs)
                    {
                        int mj = _bmat[i + hs];
                        if (mj >= 0 && (mj != mm || Math.Abs(_depth[i + hs] - z) > dzTh)) edge = true;
                    }
                    if (edge)
                    {
                        _ink[i] = 1;
                        if (x + 1 < hs) _ink[i + 1] = 1;
                    }
                }
            }
            // silhouette ink
            for (int y = ly0; y <= ly1; y++)
            {
                for (int x = lx0; x <= lx1; x++)
                {
                    int i = y * hs + x;
                    if (_bmat[i] < 0) continue;
                    bool boundary = x == 0 || y == 0 || x == hs - 1 || y == hs - 1 ||
                        _bmat[i - 1] < 0 || _bmat[i + 1] < 0 || _bmat[i - hs] < 0 || _bmat[i + hs] < 0;
                    if (!boundary) continue;
                    for (int o = 0; o < _disk.Length; o += 2)
                    {
                        int xx = x + _disk[o], yy = y + _disk[o + 1];
                        if (xx < 0 || yy < 0 || xx >= hs || yy >= hs) continue;
                        int j = yy * hs + xx;
                        if (_bmat[j] < 0) _ink[j] = 2;
                    }
                }
            }
            // shade once per output pixel, resolve coverage at hi-res
            Array.Clear(Out, 0, Out.Length);
            if (ly1 < ly0) return;
            int ss = SS;
            int samples = ss * ss;
            int ir = (Palette.Ink >> 16) & 255, ig = (Palette.Ink >> 8) & 255, ib = Palette.Ink & 255;
            int om = (_diskR + 1 + ss - 1) / ss;
            int oy0 = Math.Max(0, ly0 / ss - om), oy1 = Math.Min(Size - 1, ly1 / ss + om);
            int ox0 = Math.Max(0, lx0 / ss - om), ox1 = Math.Min(Size - 1, lx1 / ss + om);
            for (int oy = oy0; oy <= oy1; oy++)
            {
                for (int ox = ox0; ox <= ox1; ox++)
                {
                    int rep = -1;
                    for (int sy = 0; sy < ss && rep < 0; sy++)
                    {
                        int row = (oy * ss + sy) * hs + ox * ss;
                        for (int sx = 0; sx < ss; sx++)
                        {
                            int i = row + sx;
                            if (_bmat[i] >= 0 && _ink[i] == 0) { rep = i; break; }
                        }
                    }
                    int col = 0;
                    if (rep >= 0)
                    {
                        float nx = _bnx[rep], ny = _bny[rep], nz = _bnz[rep];
                        float l = M.Len(nx, ny, nz); if (l == 0f) l = 1f;
                        nx /= l; ny /= l; nz /= l;
                        if (nz < 0f) { nx = -nx; ny = -ny; nz = -nz; }
                        col = shader.Shade(_bmat[rep], _box[rep], _boy[rep], _boz[rep], nx, ny, nz, ox, oy);
                    }
                    int cr = (col >> 16) & 255, cg = (col >> 8) & 255, cb = col & 255;
                    int r = 0, g = 0, b = 0, cnt = 0;
                    for (int sy = 0; sy < ss; sy++)
                    {
                        int row = (oy * ss + sy) * hs + ox * ss;
                        for (int sx = 0; sx < ss; sx++)
                        {
                            int i = row + sx;
                            if (_ink[i] != 0) { r += ir; g += ig; b += ib; cnt++; }
                            else if (_bmat[i] >= 0) { r += cr; g += cg; b += cb; cnt++; }
                        }
                    }
                    if (cnt == 0) continue;
                    // premultiplied: (sum/samples) == (avg colour) * coverage
                    int a = 255 * cnt / samples;
                    int pr = r / samples, pg = g / samples, pb = b / samples;
                    Out[oy * Size + ox] = (a << 24) | (pr << 16) | (pg << 8) | pb;
                }
            }
        }

        private void Raster(Mesh mesh, int a, int b, int d, int mat)
        {
            int hs = HS;
            float x0 = _vx[a], y0 = _vy[a], x1 = _vx[b], y1 = _vy[b], x2 = _vx[d], y2 = _vy[d];
            float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
            if (area > -1e-9f && area < 1e-9f) return;
            float inv = 1f / area;
            int minX = (int)Math.Floor(Math.Min(x0, Math.Min(x1, x2)));
            int maxX = (int)Math.Ceiling(Math.Max(x0, Math.Max(x1, x2)));
            int minY = (int)Math.Floor(Math.Min(y0, Math.Min(y1, y2)));
            int maxY = (int)Math.Ceiling(Math.Max(y0, Math.Max(y1, y2)));
            if (minX < 0) minX = 0;
            if (minY < 0) minY = 0;
            if (maxX > hs - 1) maxX = hs - 1;
            if (maxY > hs - 1) maxY = hs - 1;
            if (minX > maxX || minY > maxY) return;
            float z0 = _vz[a], z1 = _vz[b], z2 = _vz[d];
            float a0 = (y1 - y2) * inv, b0 = (x2 - x1) * inv;
            float a1 = (y2 - y0) * inv, b1 = (x0 - x2) * inv;
            float sx0 = minX + 0.5f, sy0 = minY + 0.5f;
            float w0row = ((x1 - sx0) * (y2 - sy0) - (x2 - sx0) * (y1 - sy0)) * inv;
            float w1row = ((x2 - sx0) * (y0 - sy0) - (x0 - sx0) * (y2 - sy0)) * inv;
            const float eps = -1e-5f;
            bool touched = false;
            for (int y = minY; y <= maxY; y++)
            {
                float w0 = w0row, w1 = w1row;
                int i = y * hs + minX;
                for (int x = minX; x <= maxX; x++, i++, w0 += a0, w1 += a1)
                {
                    float w2 = 1f - w0 - w1;
                    if (w0 < eps || w1 < eps || w2 < eps) continue;
                    float z = w0 * z0 + w1 * z1 + w2 * z2;
                    if (z <= _depth[i]) continue;
                    _depth[i] = z;
                    _bmat[i] = (short)mat;
                    _bnx[i] = w0 * _wnx[a] + w1 * _wnx[b] + w2 * _wnx[d];
                    _bny[i] = w0 * _wny[a] + w1 * _wny[b] + w2 * _wny[d];
                    _bnz[i] = w0 * _wnz[a] + w1 * _wnz[b] + w2 * _wnz[d];
                    _box[i] = w0 * mesh.Px[a] + w1 * mesh.Px[b] + w2 * mesh.Px[d];
                    _boy[i] = w0 * mesh.Py[a] + w1 * mesh.Py[b] + w2 * mesh.Py[d];
                    _boz[i] = w0 * mesh.Pz[a] + w1 * mesh.Pz[b] + w2 * mesh.Pz[d];
                    touched = true;
                }
                w0row += b0;
                w1row += b1;
            }
            if (touched)
            {
                if (minX < _bx0) _bx0 = minX;
                if (maxX > _bx1) _bx1 = maxX;
                if (minY < _by0) _by0 = minY;
                if (maxY > _by1) _by1 = maxY;
            }
        }
    }
}
