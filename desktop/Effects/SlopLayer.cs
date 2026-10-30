// SlopLayer.cs
// Gooey slop stuck to one monitor edge: metaball blobs, growing drips and
// soft-serve swirls, cel-shaded per pixel into a narrow edge strip. Only rows
// that change are recomputed. Mirrors web/src/lib/engine/slop.ts + slopDraw.ts.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace SlopGrenadeDesktop
{
    internal sealed class GooBlob
    {
        public EffectMessage Message;
        public float X, Y, R, Age;
    }

    /// <summary>
    /// A drip that oozes forever: it creeps down, its tip swells and necks, a drop
    /// lets go, the drip springs back and starts again.
    /// </summary>
    internal sealed class Drip
    {
        public EffectMessage Message;
        public float X, Y0, Len, R;
        /// <summary>Length at which the swollen tip lets a drop go, and the typical length.</summary>
        public float MaxLen, BaseLen;
        /// <summary>Creep speed (px/s), pulse phase and pulse rate.</summary>
        public float Speed, Phase, Wob;
        /// <summary>Seconds of spring-back left after a drop let go, its target and velocity.</summary>
        public float Recoil, Rest, Lv;
    }

    /// <summary>A drop of goo that has let go of a drip and is falling.</summary>
    internal sealed class GooDrop
    {
        public EffectMessage Message;
        public float X, Y, R, Vy;
    }

    internal sealed class Swirl
    {
        public EffectMessage Message;
        public float X, Y, Size, Flip, Age;
    }

    internal sealed class Splat
    {
        public int Id;
        public float Y, Size, Born;
    }

    internal sealed class SlopLayer : IDisposable
    {
        public const float GooIso = 0.3f;
        private const float Support = 1.739f;

        public readonly Side Side;
        public readonly SlopPalette Pal;
        public readonly int ViewW, ViewH, StripW;
        public readonly float S;
        private readonly float _motionScale;
        public List<GooBlob> Blobs = new List<GooBlob>();
        public List<Drip> Drips = new List<Drip>();
        public List<GooDrop> Drops = new List<GooDrop>();
        public List<Swirl> Swirls = new List<Swirl>();
        public List<Splat> Splats = new List<Splat>();
        public readonly float[] Field;
        public readonly PixelSprite Sprite;
        private readonly List<int> _dirty = new List<int>();
        private int _nextSplatId = 1;
        // clock for the drip pulse, and randomness for drop sizes
        private float _time;
        private readonly Rng _rng;
        private int _upY0 = int.MaxValue, _upY1 = int.MinValue;

        public SlopLayer(Side side, SlopPalette pal, int viewW, int viewH, float scale, float motionScale)
        {
            Side = side;
            Pal = pal;
            ViewW = viewW;
            ViewH = viewH;
            S = scale;
            _motionScale = motionScale;
            StripW = Math.Max(64, (int)Math.Round(Math.Min(viewW * 0.22f, 380f * scale)));
            Field = new float[StripW * viewH];
            Sprite = new PixelSprite(StripW, viewH);
            _rng = new Rng(side == Side.Left ? 0x51a7u : 0xb10bu);
        }

        public int StripX { get { return Side == Side.Left ? 0 : ViewW - StripW; } }
        public float Inward { get { return Side == Side.Left ? 1f : -1f; } }
        public float EdgeX { get { return Side == Side.Left ? 0f : ViewW; } }

        public bool IsEmpty { get { return Blobs.Count == 0 && Drips.Count == 0 && Drops.Count == 0 && Swirls.Count == 0; } }

        /// <summary>True while goo is moving (drips ooze for as long as slop is on screen).</summary>
        public bool IsAnimating { get { return Drips.Count > 0 || Drops.Count > 0; } }

        /// <summary>Start a drip at (x, y0). Skipped when there is no room above the screen bottom.</summary>
        private void AddDrip(float x, float y0, float baseLen, float r, Rng rng, EffectMessage message)
        {
            float room = ViewH - 10f * S - y0;
            if (room < 12f * S) return;
            float b = Math.Min(baseLen, room);
            Drips.Add(new Drip
            {
                Message = message,
                X = x,
                Y0 = y0,
                Len = 0f,
                MaxLen = b * rng.Range(0.8f, 1.1f),
                BaseLen = b,
                Speed = rng.Range(9f, 20f) * _motionScale,
                Phase = rng.Range(0f, M.TAU),
                Wob = rng.Range(0.7f, 1.4f),
                R = r
            });
        }

        public int PieceCount { get { return Splats.Count; } }

        private void MarkDirty(float y0, float y1)
        {
            int a = Math.Max(0, (int)Math.Floor(y0));
            int b = Math.Min(ViewH - 1, (int)Math.Ceiling(y1));
            if (b < a) return;
            for (int i = 0; i < _dirty.Count; i += 2)
            {
                if (a <= _dirty[i + 1] + 8 && b >= _dirty[i] - 8)
                {
                    _dirty[i] = Math.Min(_dirty[i], a);
                    _dirty[i + 1] = Math.Max(_dirty[i + 1], b);
                    return;
                }
            }
            _dirty.Add(a);
            _dirty.Add(b);
            if (_dirty.Count > 64)
            {
                int lo = _dirty[0], hi = _dirty[1];
                for (int i = 2; i < _dirty.Count; i += 2) { lo = Math.Min(lo, _dirty[i]); hi = Math.Max(hi, _dirty[i + 1]); }
                _dirty.Clear();
                _dirty.Add(lo);
                _dirty.Add(hi);
            }
        }

        public int AddSplat(float y, float size, Rng rng, float now, bool withSwirl, EffectMessage message = null)
        {
            float s = S * size;
            float inw = Inward, ex = EdgeX;
            int core = 7 + (int)Math.Round(4f * size);
            for (int i = 0; i < core; i++)
            {
                float a = rng.Range(-1.3f, 1.3f);
                float d = rng.Range(0f, 40f) * s;
                Blobs.Add(new GooBlob
                {
                    Message = message,
                    X = ex + inw * (M.Cos(a) * d + 6f * s),
                    Y = y + M.Sin(a) * d * 1.6f + rng.Range(-24f, 24f) * s,
                    R = (34f + rng.Range(0f, 30f)) * s,
                    Age = -rng.Range(0f, 0.1f)
                });
            }
            int lobes = 4 + (int)Math.Round(3f * size);
            for (int i = 0; i < lobes; i++)
            {
                float a = rng.Range(-1.0f, 1.0f);
                float d = rng.Range(60f, 112f) * s;
                Blobs.Add(new GooBlob
                {
                    Message = message,
                    X = ex + inw * M.Cos(a) * d,
                    Y = y + M.Sin(a) * d * 1.15f,
                    R = rng.Range(13f, 24f) * s,
                    Age = -rng.Range(0.03f, 0.15f)
                });
            }
            int spat = 12 + (int)Math.Round(12f * size);
            for (int i = 0; i < spat; i++)
            {
                float d = rng.Range(85f, 240f) * s;
                float a = rng.Range(-1.2f, 1.2f);
                float r = rng.Range(4f, 14f) * s * (1.25f - d / (270f * s));
                Blobs.Add(new GooBlob
                {
                    Message = message,
                    X = ex + inw * M.Cos(a) * d,
                    Y = y + M.Sin(a) * d * 1.15f,
                    R = Math.Max(2.6f * S, r),
                    Age = -rng.Range(0.04f, 0.25f)
                });
            }
            int dn = 3 + (int)Math.Round(2f * size);
            for (int i = 0; i < dn; i++)
            {
                AddDrip(
                    ex + inw * (10f + (float)i / Math.Max(1, dn - 1) * 80f + rng.Range(-6f, 6f)) * s,
                    y + rng.Range(30f, 70f) * s,
                    rng.Range(90f, 300f) * s,
                    rng.Range(4.5f, 8f) * S * (0.7f + 0.3f * size),
                    rng, message);
            }
            if (withSwirl)
            {
                Swirls.Add(new Swirl { Message = message, X = ex + inw * 44f * s, Y = y - 30f * s, Size = (0.85f + rng.Range(0f, 0.3f)) * s, Flip = rng.Sign(), Age = 0f });
            }
            MarkDirty(y - 320f * s, y + 520f * s);
            int id = _nextSplatId++;
            Splats.Add(new Splat { Id = id, Y = y, Size = size, Born = now });
            return id;
        }

        public void AddGlob(float y, float r, Rng rng, EffectMessage message = null)
        {
            float inw = Inward, ex = EdgeX;
            Blobs.Add(new GooBlob { Message = message, X = ex + inw * rng.Range(-2f, 10f) * S, Y = y, R = r, Age = 0f });
            if (rng.Chance(0.55f))
            {
                AddDrip(ex + inw * rng.Range(2f, 9f) * S, y, rng.Range(50f, 150f) * S, Math.Max(2.5f * S, r * 0.45f), rng, message);
            }
            MarkDirty(y - r * 3f, y + 130f * S);
        }

        public float DensityAt(float sx, float sy)
        {
            int lx = (int)Math.Round(sx - StripX);
            int ly = (int)Math.Round(sy);
            if (lx < 0 || lx >= StripW || ly < 0 || ly >= ViewH) return 0f;
            return Field[ly * StripW + lx];
        }

        public bool HasHoverTargets
        {
            get
            {
                foreach (GooBlob blob in Blobs) if (blob.Message != null) return true;
                foreach (Drip drip in Drips) if (drip.Message != null) return true;
                foreach (GooDrop drop in Drops) if (drop.Message != null) return true;
                foreach (Swirl swirl in Swirls) if (swirl.Message != null) return true;
                return false;
            }
        }

        public EffectMessage MessageAt(float x, float y)
        {
            for (int i = Swirls.Count - 1; i >= 0; i--)
            {
                Swirl swirl = Swirls[i];
                float pop = swirl.Age >= 0.4f ? 1f : M.EaseOutBack(Math.Max(0f, swirl.Age) / 0.4f);
                if (pop <= 0.01f) continue;
                float size = 104f * swirl.Size * pop;
                float angle = Inward * 0.42f;
                float dx = x - swirl.X, dy = y - swirl.Y;
                float localX = (dx * M.Cos(angle) + dy * M.Sin(angle)) / size;
                float localY = (-dx * M.Sin(angle) + dy * M.Cos(angle)) / size;
                for (int tier = Tiers.Length - 1; tier >= 0; tier--)
                {
                    float[] t = Tiers[tier];
                    float wob = tier % 2 == 0 ? swirl.Flip : -swirl.Flip;
                    float ex = (localX - wob * 0.04f) / t[1], ey = (localY - t[0]) / t[2];
                    if (ex * ex + ey * ey <= 1f) return swirl.Message;
                }
                if (new RectangleF(-0.14f, -0.84f, 0.28f, 0.27f).Contains(localX, localY)) return swirl.Message;
            }
            int sx = (int)Math.Floor(x - StripX), sy = (int)Math.Floor(y);
            if (sx < 0 || sx >= StripW || sy < 0 || sy >= ViewH ||
                ((uint)Sprite.Pixels[sy * StripW + sx] >> 24) == 0) return null;

            // Merged goop has no single owner; use the strongest local contributor.
            float best = 0f;
            EffectMessage message = null;
            for (int i = Blobs.Count - 1; i >= 0; i--)
            {
                GooBlob blob = Blobs[i];
                SelectMessage(x - blob.X, y - blob.Y, BlobRadius(blob), blob.Message, ref best, ref message);
            }
            for (int i = Drips.Count - 1; i >= 0; i--)
            {
                Drip drip = Drips[i];
                if (y < drip.Y0 - drip.R * 3.5f || y > drip.Y0 + drip.Len + drip.R * 3.5f) continue;
                float step = Math.Max(1.5f, drip.R * 0.55f);
                int count = Math.Max(1, (int)Math.Ceiling(drip.Len / step));
                for (int k = 0; k <= count; k++)
                {
                    float fraction = (float)k / count;
                    SelectMessage(x - drip.X, y - drip.Y0 - drip.Len * fraction,
                        DripRadius(drip, fraction), drip.Message, ref best, ref message);
                }
            }
            for (int i = Drops.Count - 1; i >= 0; i--)
            {
                GooDrop drop = Drops[i];
                SelectMessage(x - drop.X, y - drop.Y, drop.R, drop.Message, ref best, ref message);
                float stretch = Math.Min(1.8f, 0.6f + drop.Vy / (420f * _motionScale));
                SelectMessage(x - drop.X, y - drop.Y + drop.R * 0.95f * stretch, drop.R * 0.62f, drop.Message, ref best, ref message);
            }
            return message;
        }

        private static void SelectMessage(float dx, float dy, float radius, EffectMessage candidate, ref float best, ref EffectMessage message)
        {
            if (candidate == null || radius <= 0.2f) return;
            float support = radius * Support + 4f;
            float weight = 1f - (dx * dx + dy * dy) / (support * support);
            if (weight <= best) return;
            best = weight;
            message = candidate;
        }

        private static float DripRadius(Drip drip, float fraction)
        {
            float ripe = drip.Recoil > 0f ? 0f : M.Clamp01(drip.Len / drip.MaxLen);
            float swell = 0.45f + 0.75f * ripe;
            float scale = 1f - 0.18f * fraction;
            if (fraction > 0.55f && fraction < 0.88f)
                scale *= 1f - 0.55f * ripe * ripe * M.Sin((fraction - 0.55f) / 0.33f * M.PI);
            if (fraction > 0.82f)
                scale = Math.Max(scale, 1f + swell * M.Sin((fraction - 0.82f) / 0.18f * M.PI * 0.5f));
            return drip.R * scale * 0.82f;
        }

        /// <summary>Screen x of the goo surface at height y, or NaN when there is none.</summary>
        public float SurfaceXAt(float y)
        {
            int ly = (int)Math.Round(y);
            if (ly < 0 || ly >= ViewH) return float.NaN;
            int row = ly * StripW;
            if (Side == Side.Left)
            {
                for (int x = StripW - 1; x >= 0; x--) if (Field[row + x] >= GooIso) return x + StripX;
            }
            else
            {
                for (int x = 0; x < StripW; x++) if (Field[row + x] >= GooIso) return x + StripX;
            }
            return float.NaN;
        }

        public bool Update(float dt)
        {
            bool moved = false;
            for (int i = 0; i < Blobs.Count; i++)
            {
                GooBlob b = Blobs[i];
                if (b.Age < 0.22f)
                {
                    b.Age += dt;
                    MarkDirty(b.Y - b.R * 2.2f, b.Y + b.R * 2.2f);
                    moved = true;
                }
            }
            _time += dt;
            for (int i = 0; i < Drips.Count; i++)
            {
                Drip d = Drips[i];
                float old = d.Len;
                if (d.Recoil > 0f)
                {
                    // the drip springs back up after letting a drop go (with a little bounce)
                    d.Recoil -= dt;
                    float a = (d.Rest - d.Len) * 90f - d.Lv * 8f;
                    d.Lv += a * dt;
                    d.Len = Math.Max(0f, d.Len + d.Lv * dt);
                    if (d.Recoil <= 0f) d.Lv = 0f;
                }
                else
                {
                    // slow, pulsing creep that speeds up as the tip gets heavy
                    float ripe = M.Clamp01(d.Len / d.MaxLen);
                    float pulse = 0.55f + 0.45f * M.Sin(_time * d.Wob * 1.6f + d.Phase);
                    d.Len += d.Speed * pulse * (1f + 1.6f * ripe * ripe) * dt;
                    if (d.Len >= d.MaxLen)
                    {
                        // the neck gives way: a drop lets go and the drip snaps back
                        Drops.Add(new GooDrop { Message = d.Message, X = d.X, Y = d.Y0 + d.Len + d.R * 0.8f, R = d.R * _rng.Range(1.2f, 1.5f), Vy = d.Speed * 1.5f });
                        d.Rest = d.Len * _rng.Range(0.3f, 0.55f);
                        d.Recoil = 0.7f;
                        d.Lv = 0f;
                        d.MaxLen = d.BaseLen * _rng.Range(0.8f, 1.15f);
                    }
                }
                MarkDirty(d.Y0 + Math.Min(old, d.Len) - d.R * 4f, d.Y0 + Math.Max(old, d.Len) + d.R * 4.5f);
                moved = true;
            }
            for (int i = Drops.Count - 1; i >= 0; i--)
            {
                GooDrop p = Drops[i];
                float oldY = p.Y;
                p.Vy += 700f * _motionScale * dt;
                p.Y += p.Vy * dt;
                MarkDirty(oldY - p.R * 4.5f, p.Y + p.R * 2.5f);
                if (p.Y - p.R * 3f > ViewH) Drops.RemoveAt(i);
                moved = true;
            }
            for (int i = 0; i < Swirls.Count; i++)
            {
                if (Swirls[i].Age < 1f) { Swirls[i].Age += dt; moved = true; }
            }
            return moved;
        }

        /// <summary>Squeegee at bladeY scrapes everything above it. Returns scraped mass.</summary>
        public float ScrapeAbove(float bladeY)
        {
            float mass = 0f;
            List<GooBlob> keepB = new List<GooBlob>(Blobs.Count);
            foreach (GooBlob b in Blobs)
            {
                if (b.Y + b.R < bladeY) mass += b.R * b.R;
                else keepB.Add(b);
            }
            Blobs = keepB;
            List<Drip> keepD = new List<Drip>(Drips.Count);
            foreach (Drip d in Drips)
            {
                float bottom = d.Y0 + d.Len;
                if (bottom < bladeY) { mass += d.R * d.Len * 0.5f; continue; }
                if (d.Y0 < bladeY)
                {
                    float cut = bladeY - d.Y0;
                    d.Y0 = bladeY;
                    d.Len = Math.Max(0f, d.Len - cut);
                    d.Rest = Math.Max(0f, d.Rest - cut);
                    d.MaxLen = Math.Max(d.Len + 4f * S, d.MaxLen - cut);
                }
                keepD.Add(d);
            }
            Drips = keepD;
            Drops.RemoveAll(delegate(GooDrop p) { return p.Y < bladeY; });
            Swirls.RemoveAll(delegate(Swirl sw) { return sw.Y + 40f * sw.Size < bladeY; });
            Splats.RemoveAll(delegate(Splat sp) { return sp.Y < bladeY; });
            if (mass > 0f) MarkDirty(0f, bladeY + 16f * S);
            return mass;
        }

        public void Clear()
        {
            bool had = !IsEmpty;
            Blobs.Clear();
            Drips.Clear();
            Drops.Clear();
            Swirls.Clear();
            Splats.Clear();
            if (had) MarkDirty(0f, ViewH);
        }

        private float BlobRadius(GooBlob b)
        {
            if (b.Age <= 0f) return 0f;
            if (b.Age >= 0.22f) return b.R;
            return b.R * M.EaseOutBack(b.Age / 0.22f);
        }

        /// <summary>
        /// Recompute dirty rows (at most `rowBudget` rows this call; the rest stay
        /// queued). Returns true if pixels changed.
        /// </summary>
        public bool Flush(int rowBudget)
        {
            if (_dirty.Count == 0) return false;
            List<int[]> list = new List<int[]>();
            for (int i = 0; i < _dirty.Count; i += 2) list.Add(new int[] { _dirty[i], _dirty[i + 1] });
            _dirty.Clear();
            list.Sort(delegate(int[] p, int[] q) { return p[0].CompareTo(q[0]); });
            List<int[]> merged = new List<int[]>();
            foreach (int[] iv in list)
            {
                if (merged.Count > 0 && iv[0] <= merged[merged.Count - 1][1] + 8)
                    merged[merged.Count - 1][1] = Math.Max(merged[merged.Count - 1][1], iv[1]);
                else
                    merged.Add(new int[] { iv[0], iv[1] });
            }
            int budget = rowBudget;
            bool changed = false;
            foreach (int[] iv in merged)
            {
                if (budget <= 0)
                {
                    _dirty.Add(iv[0]);
                    _dirty.Add(iv[1]);
                    continue;
                }
                int y0 = iv[0];
                int y1 = Math.Min(iv[1], y0 + budget - 1);
                budget -= y1 - y0 + 1;
                if (y1 < iv[1])
                {
                    _dirty.Add(y1 + 1);
                    _dirty.Add(iv[1]);
                }
                ComputeField(Math.Max(0, y0 - 2), Math.Min(ViewH - 1, y1 + 2));
                ShadeRows(y0, y1);
                if (y0 < _upY0) _upY0 = y0;
                if (y1 > _upY1) _upY1 = y1;
                changed = true;
            }
            return changed;
        }

        /// <summary>Rows whose pixels changed since the last call (inclusive) or false.</summary>
        public bool TakeDirtyRows(out int y0, out int y1)
        {
            y0 = 0; y1 = -1;
            if (_upY1 < _upY0) return false;
            y0 = Math.Max(0, _upY0);
            y1 = Math.Min(ViewH - 1, _upY1);
            _upY0 = int.MaxValue;
            _upY1 = int.MinValue;
            return true;
        }

        private void SplatKernel(float cx, float cy, float r, int y0, int y1)
        {
            if (r <= 0.2f) return;
            int W = StripW;
            float R = r * Support, R2 = R * R, inv = 1f / R2;
            float lx = cx - StripX;
            int ya = Math.Max(y0, (int)Math.Floor(cy - R)), yb = Math.Min(y1, (int)Math.Ceiling(cy + R));
            int xa = Math.Max(0, (int)Math.Floor(lx - R)), xb = Math.Min(W - 1, (int)Math.Ceiling(lx + R));
            float[] f = Field;
            for (int y = ya; y <= yb; y++)
            {
                float dy = y + 0.5f - cy;
                float dy2 = dy * dy;
                if (dy2 >= R2) continue;
                int row = y * W;
                for (int x = xa; x <= xb; x++)
                {
                    float dx = x + 0.5f - lx;
                    float d2 = dx * dx + dy2;
                    if (d2 >= R2) continue;
                    float t = 1f - d2 * inv;
                    f[row + x] += t * t * t;
                }
            }
        }

        private void ComputeField(int y0, int y1)
        {
            int W = StripW;
            Array.Clear(Field, y0 * W, (y1 - y0 + 1) * W);
            for (int i = 0; i < Blobs.Count; i++)
            {
                GooBlob b = Blobs[i];
                float r = BlobRadius(b);
                float R = r * Support;
                if (b.Y + R < y0 || b.Y - R > y1) continue;
                SplatKernel(b.X, b.Y, r, y0, y1);
            }
            for (int i = 0; i < Drips.Count; i++)
            {
                Drip d = Drips[i];
                if (d.Len <= 0.5f) continue;
                float top = d.Y0, bot = d.Y0 + d.Len;
                float reach = d.R * Support * 2.2f;
                if (bot + reach < y0 || top - reach > y1) continue;
                float step = Math.Max(1.5f, d.R * 0.55f);
                int n = Math.Max(1, (int)Math.Ceiling(d.Len / step));
                for (int k = 0; k <= n; k++)
                {
                    float f = (float)k / n;
                    float yy = top + d.Len * f;
                    float radius = DripRadius(d, f);
                    if (yy + radius * Support < y0 || yy - radius * Support > y1) continue;
                    SplatKernel(d.X, yy, radius, y0, y1);
                }
            }
            for (int i = 0; i < Drops.Count; i++)
            {
                // a teardrop: round body plus a thinner tail that stretches as it speeds up
                GooDrop p = Drops[i];
                float stretch = Math.Min(1.8f, 0.6f + p.Vy / (420f * _motionScale));
                float tailY = p.Y - p.R * 0.95f * stretch;
                if (p.Y + p.R * Support < y0 || tailY - p.R * Support > y1) continue;
                SplatKernel(p.X, p.Y, p.R, y0, y1);
                SplatKernel(p.X, tailY, p.R * 0.62f, y0, y1);
            }
        }

        private void ShadeRows(int y0, int y1)
        {
            int W = StripW, H = ViewH;
            float[] F = Field;
            int[] P = Sprite.Pixels;
            SlopPalette pal = Pal;
            float ow = 2.4f * S + 0.6f;
            const float T = GooIso;
            const float lx = -0.5f, ly = -0.64f, lz = 0.58f;
            float hx = lx, hy = ly, hz = lz + 1f;
            float hl = M.Len(hx, hy, hz);
            float hs = 3.2f / T;
            int ink = unchecked((int)0xff000000) | Palette.Ink;
            for (int y = y0; y <= y1; y++)
            {
                int row = y * W;
                for (int x = 0; x < W; x++)
                {
                    int i = row + x;
                    float f = F[i];
                    if (f < T * 0.45f) { P[i] = 0; continue; }
                    float fl = x > 1 ? F[i - 2] : f;
                    float fr = x < W - 2 ? F[i + 2] : f;
                    float fu = y > 1 ? F[i - 2 * W] : f;
                    float fd = y < H - 2 ? F[i + 2 * W] : f;
                    float gx = (fr - fl) * 0.25f, gy = (fd - fu) * 0.25f;
                    float gl = (float)Math.Sqrt(gx * gx + gy * gy);
                    float di = (f - T) / (gl > 1e-4f ? gl : 1e-4f);
                    if (di < -1f) { P[i] = 0; continue; }
                    if (di < ow)
                    {
                        if (di < 0f) P[i] = M.Premul(Palette.Ink, (int)(255f * M.Clamp01(di + 1f)));
                        else P[i] = ink;
                        continue;
                    }
                    float nx = -gx * hs, ny = -gy * hs, nz = 1f;
                    float nl = (float)Math.Sqrt(nx * nx + ny * ny + nz * nz);
                    nx /= nl; ny /= nl; nz /= nl;
                    float ndl = nx * lx + ny * ly + nz * lz;
                    float spec = (nx * hx + ny * hy + nz * hz) / hl;
                    int c;
                    if (spec > 0.975f) c = pal.Gloss;
                    else if (ndl > 0.74f) c = pal.Light;
                    else if (ndl > 0.28f) c = pal.Base;
                    else if (ndl > -0.12f) c = pal.Shadow;
                    else c = (di > 7f * S && (x + y) % 6 < 2) ? pal.Hatch : pal.Deep;
                    if (di < ow + 0.9f * S && c != pal.Gloss) c = pal.Shadow;
                    P[i] = unchecked((int)0xff000000) | c;
                }
            }
        }

        /// <summary>Draws the soft-serve swirl mounds (vector, on top of the goo).</summary>
        public void DrawSwirls(Graphics g)
        {
            for (int i = 0; i < Swirls.Count; i++) DrawSwirl(g, Swirls[i]);
        }

        private static readonly float[][] Tiers = new float[][]
        {
            new float[] { 0f, 0.5f, 0.21f }, new float[] { -0.27f, 0.4f, 0.19f }, new float[] { -0.51f, 0.29f, 0.16f }
        };

        private void DrawSwirl(Graphics g, Swirl sw)
        {
            float pop = sw.Age >= 0.4f ? 1f : M.EaseOutBack(Math.Max(0f, sw.Age) / 0.4f);
            if (pop <= 0.01f) return;
            float Sz = 104f * sw.Size * pop;
            float lw = 3f * S;
            float inward = Inward;
            GraphicsState st = g.Save();
            g.TranslateTransform(sw.X, sw.Y);
            g.RotateTransform(inward * 0.42f * 57.2957795f);
            float ang = -inward * 0.42f;
            float lx = -0.55f * M.Cos(ang) + 0.64f * M.Sin(ang);
            float ly = -0.55f * M.Sin(ang) - 0.64f * M.Cos(ang);
            for (int i = 0; i < Tiers.Length; i++)
            {
                float[] t = Tiers[i];
                float wob = i % 2 == 0 ? sw.Flip : -sw.Flip;
                Ink.CelEllipse(g, wob * Sz * 0.04f, t[0] * Sz, t[1] * Sz, t[2] * Sz, Pal.Base, Pal.Shadow, Pal.Light, lw, lx, ly, true, 1f);
            }
            float tx = sw.Flip * Sz * 0.05f, ty = -0.68f * Sz;
            using (GraphicsPath p = new GraphicsPath())
            {
                p.AddBezier(tx - Sz * 0.14f, ty + Sz * 0.1f,
                    tx - Sz * 0.12f, ty - Sz * 0.05f, tx - Sz * 0.02f, ty - Sz * 0.15f, tx + sw.Flip * Sz * 0.12f, ty - Sz * 0.16f);
                p.AddBezier(tx + sw.Flip * Sz * 0.12f, ty - Sz * 0.16f,
                    tx + sw.Flip * Sz * 0.06f, ty - Sz * 0.08f, tx + Sz * 0.08f, ty + Sz * 0.0f, tx + Sz * 0.14f, ty + Sz * 0.1f);
                p.CloseFigure();
                g.FillPath(Ink.Brush(Pal.Base, 1f), p);
                g.DrawPath(Ink.Pen(Palette.Ink, lw, 1f), p);
            }
            g.Restore(st);
        }

        public void Dispose()
        {
            Sprite.Dispose();
        }
    }
}
