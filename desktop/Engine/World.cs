// World.cs
// The Slop Grenade "game world": owns every effect, the event director that
// paces bursts of messages, bullet-time, and the back-to-front render order.
// Mirrors web/src/lib/engine/world.ts, plus dirty-rectangle bookkeeping for
// the layered desktop window.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace SlopGrenadeDesktop
{
    internal sealed class CannonBall
    {
        public EffectMessage Message;
        public float X, Y, Vx, Vy, Age;
        public readonly float R, TargetY;
        public readonly Side Side;
        public bool Done;

        public CannonBall(Side side, int w, int h, float s, Rng rng)
        {
            Side = side;
            float inward = side == Side.Left ? 1f : -1f;
            R = 20f * s;
            TargetY = h * rng.Range(0.15f, 0.75f);
            X = w * 0.5f + inward * w * rng.Range(0.1f, 0.4f);
            Y = h + 40f * s;
            float T = rng.Range(0.75f, 0.95f);
            float g = 1700f * s;
            float tx = side == Side.Left ? 0f : w;
            Vx = (tx - X) / T;
            Vy = (TargetY - Y - 0.5f * g * T * T) / T;
        }
    }

    internal sealed class World : IDisposable
    {
        private struct Queued
        {
            public EffectTier Tier;
            public Side Side;
            public EffectMessage Message;
        }

        private sealed class Emitter
        {
            public float T, X, Y, Vx, Vy, Amount, Soot;
        }

        /// <summary>Size of grenades, fruit, slop, smoke and explosions relative to the screen scale.</summary>
        public const float ItemScale = 0.42f;
        // bullet-time only for the last moment of the grenade's flight
        private const float SlowmoFrom = 0.8f, SlowmoTo = 0.97f, SlowmoScale = 0.3f;
        // business-friendly blast: smaller, a brief freeze and only a slight shake
        private const float ExplosionSize = 0.75f, HitStop = 0.04f, ShakeAmount = 0.3f;

        public readonly int W, H;
        /// <summary>Item scale (everything that flies, splats or explodes).</summary>
        public readonly float S;
        /// <summary>Screen scale (1 at 1080p) for things that must stay readable: twinkles, flies.</summary>
        public readonly float UI;
        public readonly Rng Rng;
        public readonly SlopLayer Left, Right;
        public readonly List<Grenade> Grenades = new List<Grenade>();
        public readonly List<Explosion> Explosions = new List<Explosion>();
        public readonly ParticleSystem Particles = new ParticleSystem(700);
        public readonly List<Fruit> Fruits = new List<Fruit>();
        public readonly List<CannonBall> Cannon = new List<CannonBall>();
        public readonly SmokeField Smoke;
        public readonly FlySwarm Flies;
        public readonly List<Twinkle> Twinkles = new List<Twinkle>();
        public readonly List<Squeegee> Squeegees = new List<Squeegee>();
        public ISfxSink Sfx;
        public float Now;
        public float TimeScale = 1f;
        private float _hitStop, _shake, _shakeX, _shakeY;
        private bool _slowmoOn;
        private readonly List<Queued> _queue = new List<Queued>();
        private readonly List<Emitter> _emitters = new List<Emitter>();
        private readonly List<KeyValuePair<float, Queued>> _scheduled = new List<KeyValuePair<float, Queued>>();
        private float _sinceGrenade = 99f, _sinceFruit = 99f, _clockReal;
        private readonly ToonRenderer _toon;
        private readonly List<RectangleF> _activity = new List<RectangleF>();
        private readonly ImageAttributes _smokeAttrs;
        private int _smokeFrame;

        public World(int w, int h, float flyDelay, uint seed)
        {
            W = w;
            H = h;
            UI = M.Clamp(h / 1080f, 0.35f, 2.5f);
            S = UI * ItemScale;
            Rng = new Rng(seed);
            Left = new SlopLayer(Side.Left, Palette.Pink, w, h, S);
            Right = new SlopLayer(Side.Right, Palette.Blue, w, h, S);
            Smoke = new SmokeField(w, h, 90);
            Flies = new FlySwarm(flyDelay, 12);
            _toon = new ToonRenderer((int)Math.Ceiling(46f * S * 2.9f), 2, 2.2f * Math.Max(0.6f, S));
            _smokeAttrs = new ImageAttributes();
            _smokeAttrs.SetWrapMode(WrapMode.TileFlipXY);
        }

        public SlopLayer Layer(Side side) { return side == Side.Left ? Left : Right; }

        private static float Pan(Side side) { return side == Side.Left ? -0.75f : 0.75f; }

        private void Play(string name, float pan, float gain, float rate)
        {
            if (Sfx != null) Sfx.Play(name, pan, gain, rate);
        }

        private void Loop(string id, string name, float pan, float gain, float rate)
        {
            if (Sfx != null) Sfx.Loop(id, name, pan, gain, rate);
        }

        public void Trigger(EffectTier tier, Side side, EffectMessage message = null)
        {
            if (tier == EffectTier.SlopGrenade)
            {
                int queued = 0;
                foreach (Queued q in _queue) if (q.Tier == EffectTier.SlopGrenade) queued++;
                if (queued >= 12)
                {
                    Layer(side).AddSplat(H * Rng.Range(0.15f, 0.8f), 0.8f, Rng, Now, true, message);
                    return;
                }
            }
            Queued item;
            item.Tier = tier;
            item.Side = side;
            item.Message = message;
            _queue.Add(item);
        }

        /// <summary>Queue an effect `delay` real seconds from now (used by the showcase).</summary>
        public void TriggerLater(float delay, EffectTier tier, Side side, EffectMessage message = null)
        {
            Queued item;
            item.Tier = tier;
            item.Side = side;
            item.Message = message;
            _scheduled.Add(new KeyValuePair<float, Queued>(_clockReal + delay, item));
        }

        public void SqueegeeSide(Side side)
        {
            SlopLayer L = Layer(side);
            Squeegees.Add(new Squeegee(side, W, H, L.StripW, L.Pal));
            Play("squeegee", Pan(side), 0.8f, 1f);
        }

        public void SlopCounts(out int left, out int right)
        {
            int lf = 0, rf = 0;
            foreach (Fruit f in Fruits)
            {
                if (f.State != FruitState.Stuck) continue;
                if (f.Side == Side.Left) lf++; else rf++;
            }
            left = Left.PieceCount + lf;
            right = Right.PieceCount + rf;
        }

        public bool HasHoverTargets
        {
            get
            {
                foreach (KeyValuePair<float, Queued> pair in _scheduled) if (pair.Value.Message != null) return true;
                foreach (Queued item in _queue) if (item.Message != null) return true;
                foreach (Fruit fruit in Fruits) if (fruit.Message != null && fruit.State != FruitState.Gone) return true;
                foreach (Grenade grenade in Grenades) if (grenade.Message != null && !grenade.Done) return true;
                foreach (CannonBall cannon in Cannon) if (cannon.Message != null && !cannon.Done) return true;
                foreach (Twinkle twinkle in Twinkles) if (twinkle.Message != null && !twinkle.Done) return true;
                foreach (Particle particle in Particles.Items) if (particle.Message != null && !particle.Dead) return true;
                return Left.HasHoverTargets || Right.HasHoverTargets;
            }
        }

        public EffectMessage MessageAt(float x, float y)
        {
            if (x < 0 || y < 0 || x >= W || y >= H) return null;
            for (int i = Twinkles.Count - 1; i >= 0; i--)
            {
                Twinkle twinkle = Twinkles[i];
                if (!twinkle.Done && twinkle.Envelope() > 0.01f && HitCircle(x - twinkle.X, y - twinkle.Y, twinkle.Size))
                    return twinkle.Message;
            }
            for (int i = Particles.Items.Count - 1; i >= 0; i--)
            {
                Particle particle = Particles.Items[i];
                if (particle.Kind == ParticleKind.Glob && !particle.Dead &&
                    HitCircle(x - particle.X - _shakeX, y - particle.Y - _shakeY, particle.R))
                    return particle.Message;
            }
            for (int i = Grenades.Count - 1; i >= 0; i--)
            {
                Grenade grenade = Grenades[i];
                if (!grenade.Done && HitCircle(x - grenade.X - _shakeX, y - grenade.Y - _shakeY, 56f * S))
                    return grenade.Message;
            }
            for (int i = Cannon.Count - 1; i >= 0; i--)
            {
                CannonBall cannon = Cannon[i];
                if (!cannon.Done && HitCircle(x - cannon.X - _shakeX, y - cannon.Y - _shakeY, cannon.R * 1.25f))
                    return cannon.Message;
            }
            for (int pass = 0; pass < 2; pass++)
                for (int i = Fruits.Count - 1; i >= 0; i--)
                {
                    Fruit fruit = Fruits[i];
                    if (fruit.State == FruitState.Gone || fruit.Sprite == null ||
                        (pass == 1) != (fruit.State == FruitState.Stuck)) continue;
                    float squish = fruit.Squish;
                    int px = (int)Math.Floor((x - fruit.X) / squish + fruit.Sprite.Width / 2);
                    int py = (int)Math.Floor((y - fruit.Y) / (2f - squish) + fruit.Sprite.Height / 2);
                    if (px >= 0 && py >= 0 && px < fruit.Sprite.Width && py < fruit.Sprite.Height &&
                        ((uint)fruit.Sprite.Pixels[py * fruit.Sprite.Width + px] >> 24) != 0) return fruit.Message;
                }
            EffectMessage left = Left.MessageAt(x, y);
            return left ?? Right.MessageAt(x, y);
        }

        private static bool HitCircle(float x, float y, float radius)
        {
            return x * x + y * y <= radius * radius;
        }

        public bool IsIdle
        {
            get
            {
                if (_queue.Count > 0 || _scheduled.Count > 0 || Grenades.Count > 0 || Explosions.Count > 0 || Particles.Items.Count > 0) return false;
                if (Cannon.Count > 0 || Twinkles.Count > 0 || Squeegees.Count > 0 || Flies.Flies.Count > 0 || _emitters.Count > 0) return false;
                if (!Smoke.IsEmpty || TimeScale < 0.99f) return false;
                foreach (Fruit f in Fruits) if (f.State != FruitState.Stuck || f.StuckT < 1.2f) return false;
                foreach (Swirl sw in Left.Swirls) if (sw.Age < 1f) return false;
                foreach (Swirl sw in Right.Swirls) if (sw.Age < 1f) return false;
                if (Left.IsAnimating || Right.IsAnimating) return false;
                foreach (GooBlob b in Left.Blobs) if (b.Age < 0.22f) return false;
                foreach (GooBlob b in Right.Blobs) if (b.Age < 0.22f) return false;
                return true;
            }
        }

        /// <summary>True when only slow things move (drips, flies, settling smoke) — 30 fps is enough.</summary>
        public bool IsCalm
        {
            get
            {
                return Grenades.Count == 0 && Explosions.Count == 0 && Cannon.Count == 0 && Squeegees.Count == 0
                    && Particles.Items.Count == 0 && TimeScale > 0.99f && !HasFlyingFruit;
            }
        }

        private bool HasFlyingFruit
        {
            get
            {
                foreach (Fruit f in Fruits) if (f.State == FruitState.Flying || f.State == FruitState.Falling) return true;
                return false;
            }
        }

        private bool HasPendingSplat(Side side)
        {
            foreach (Grenade g in Grenades) if (!g.Done && g.Side == side) return true;
            foreach (CannonBall c in Cannon) if (!c.Done && c.Side == side) return true;
            foreach (Queued q in _queue)
                if (q.Side == side && (q.Tier == EffectTier.SlopGrenade || q.Tier == EffectTier.SlopSplat))
                    return true;
            return false;
        }

        private void StartNext()
        {
            for (int i = 0; i < _queue.Count; i++)
            {
                Queued q = _queue[i];
                if (q.Tier == EffectTier.SlopGrenade)
                {
                    if (Grenades.Count >= 2 || _sinceGrenade < 1.1f) continue;
                    _queue.RemoveAt(i);
                    LaunchGrenade(q.Side, q.Message);
                    return;
                }
                if (q.Tier == EffectTier.InnocentFruit)
                {
                    int flying = 0;
                    foreach (Fruit f in Fruits) if (f.State == FruitState.Flying) flying++;
                    if (flying >= 3 || _sinceFruit < 0.45f) continue;
                    if (Layer(q.Side).Splats.Count == 0 && HasPendingSplat(q.Side)) continue;
                    _queue.RemoveAt(i);
                    TossFruit(q.Side, q.Message);
                    return;
                }
                _queue.RemoveAt(i);
                if (q.Tier == EffectTier.SlopSplat) FireCannon(q.Side, q.Message);
                else if (q.Tier == EffectTier.PeacefulCloud) PlumeSmoke(q.Side);
                else DoTwinkle(q.Side, q.Message);
                return;
            }
        }

        private void LaunchGrenade(Side side, EffectMessage message)
        {
            Grenade g = new Grenade(side, Palette.ForSide(side), W, H, S, Rng);
            g.Message = message;
            Grenades.Add(g);
            _sinceGrenade = 0f;
            Particle ring = Particles.Spawn(ParticleKind.Ring);
            ring.X = g.X;
            ring.Y = H - 10f * S;
            ring.Vx = -g.Vx * 0.15f + Rng.Range(-80f, 80f) * S;
            ring.Vy = -Rng.Range(500f, 700f) * S;
            ring.Gravity = 1600f * S;
            ring.Spin = Rng.Range(-9f, 9f);
            ring.Life = 3f;
            ring.R = S;
            Play("throw", Pan(side) * 0.3f, 0.8f, 1f);
        }

        private void TossFruit(Side side, EffectMessage message)
        {
            SlopLayer L = Layer(side);
            float ty = H * Rng.Range(0.18f, 0.78f);
            if (L.Splats.Count > 0 && Rng.Chance(0.65f))
            {
                Splat sp = L.Splats[Rng.Int(L.Splats.Count)];
                ty = sp.Y + Rng.Range(-50f, 60f) * S;
            }
            Fruits.Add(new Fruit(Rng.Int(FruitModels.Count), side, W, H, S, Rng, ty) { Message = message });
            _sinceFruit = 0f;
            Play("whoosh", Pan(side) * 0.4f, 0.5f, 0.7f);
        }

        private void FireCannon(Side side, EffectMessage message)
        {
            Cannon.Add(new CannonBall(side, W, H, S, Rng) { Message = message });
            Play("cannon", Pan(side) * 0.4f, 0.7f, 1f);
        }

        private void PlumeSmoke(Side side)
        {
            float y = H * Rng.Range(0.3f, 0.88f);
            float x = side == Side.Left ? 2f : W - 2f;
            float inward = side == Side.Left ? 1f : -1f;
            const int n = 22;
            for (int i = 0; i < n; i++)
            {
                float k = (float)i / n;
                Emitter e = new Emitter();
                e.T = k * 1.6f + Rng.Range(0f, 0.05f);
                e.X = x;
                e.Y = y + M.Sin(k * 7f) * 18f * S + Rng.Range(-12f, 12f) * S;
                e.Vx = inward * Rng.Range(240f, 360f) * S * (1f - 0.35f * k);
                e.Vy = -Rng.Range(50f, 140f) * S;
                e.Amount = Rng.Range(0.3f, 0.42f) * (1f - 0.3f * k);
                e.Soot = 0.04f;
                _emitters.Add(e);
            }
            Play("smoke", Pan(side), 0.55f, 1f);
        }

        private void DoTwinkle(Side side, EffectMessage message)
        {
            float inward = side == Side.Left ? 1f : -1f;
            float ex = side == Side.Left ? 0f : W;
            float y = H * Rng.Range(0.12f, 0.88f);
            // one big glint, then one or two small ones nearby
            int n = 2 + Rng.Int(2);
            float x0 = ex + inward * Rng.Range(60f, 150f) * UI;
            for (int i = 0; i < n; i++)
            {
                float dx = i == 0 ? 0f : inward * Rng.Range(20f, 60f) * UI;
                float dy = i == 0 ? 0f : Rng.Range(-55f, 55f) * UI;
                Twinkles.Add(new Twinkle(x0 + dx, y + dy, i * Rng.Range(0.25f, 0.45f), UI, Rng, i == 0) { Message = message });
            }
            Play("twinkle", Pan(side), 0.4f, Rng.Range(0.9f, 1.15f));
        }

        private void Detonate(Grenade g)
        {
            Side side = g.Side;
            float inward = side == Side.Left ? 1f : -1f;
            SlopLayer L = Layer(side);
            // kept modest: this runs on people's work screens
            Explosions.Add(new Explosion(g.X, g.Y, inward, S, Rng, side == Side.Right, ExplosionSize));
            L.AddSplat(g.Y, 1f, Rng, Now, true, g.Message);
            for (int i = 0; i < 16; i++)
            {
                Particle p = Particles.Spawn(ParticleKind.Glob);
                p.Message = g.Message;
                bool toEdge = i < 7;
                float a = toEdge ? (inward > 0f ? M.PI : 0f) + Rng.Range(-1.1f, 1.1f) : (inward > 0f ? 0f : M.PI) + Rng.Range(-1.4f, 1.4f);
                float sp = Rng.Range(300f, 750f) * S;
                p.X = g.X + inward * Rng.Range(10f, 30f) * S;
                p.Y = g.Y + Rng.Range(-20f, 20f) * S;
                p.Vx = M.Cos(a) * sp;
                p.Vy = M.Sin(a) * sp - Rng.Range(80f, 280f) * S;
                p.R = Rng.Range(4f, 12f) * S;
                p.Gravity = 1300f * S;
                p.Drag = 0.6f;
                p.Life = 4f;
                p.Pal = L.Pal;
                p.Sticky = toEdge ? (side == Side.Left ? 0 : 1) : -1;
            }
            Particles.Sparks(g.X, g.Y, 12, 800f * S, S, Rng);
            Smoke.Puff(g.X + inward * 40f * S, g.Y, 80f * S, 1.1f, inward * 200f * S, -100f * S, 0.7f);
            _hitStop = HitStop;
            _shake = ShakeAmount;
            Loop("fuse-" + side, null, 0f, 0f, 1f);
            Play("explosion", Pan(side), 1f, 1f);
        }

        private void StickFruit(Fruit f)
        {
            SlopLayer L = Layer(f.Side);
            f.State = FruitState.Stuck;
            f.StuckT = 0f;
            float inward = f.Side == Side.Left ? 1f : -1f;
            L.AddGlob(f.Y + f.R * 0.2f, f.R * 0.5f, Rng, f.Message);
            int juice = FruitModels.Juice(f.Kind);
            for (int i = 0; i < 10; i++)
            {
                Particle p = Particles.Spawn(ParticleKind.Juice);
                float a = (inward > 0f ? 0f : M.PI) + Rng.Range(-1.3f, 1.3f) - M.PI * 0.15f * inward;
                float sp = Rng.Range(140f, 420f) * S;
                p.X = f.LeadX;
                p.Y = f.Y;
                p.Vx = M.Cos(a) * sp;
                p.Vy = M.Sin(a) * sp - 120f * S;
                p.R = Rng.Range(2.5f, 5f) * S;
                p.Gravity = 1100f * S;
                p.Life = 1.4f;
                p.Color = juice;
            }
            Play("squelch", Pan(f.Side), 0.75f, Rng.Range(0.9f, 1.1f));
        }

        private void OnGlobStick(Particle p)
        {
            Side side = p.Sticky == 0 ? Side.Left : Side.Right;
            Layer(side).AddGlob(p.Y, p.R * 1.3f, Rng, p.Message);
        }

        public void Update(float dtReal)
        {
            float dtR = M.Clamp(dtReal, 0f, 0.05f);
            _clockReal += dtR;
            for (int i = _scheduled.Count - 1; i >= 0; i--)
            {
                if (_scheduled[i].Key <= _clockReal)
                {
                    Queued q = _scheduled[i].Value;
                    _scheduled.RemoveAt(i);
                    Trigger(q.Tier, q.Side, q.Message);
                }
            }
            float target = 1f;
            foreach (Grenade g in Grenades)
            {
                float t = g.T;
                if (t > SlowmoFrom && t < SlowmoTo) target = SlowmoScale;
            }
            if (_hitStop > 0f)
            {
                _hitStop -= dtR;
                TimeScale = 0.04f;
            }
            else
            {
                float rate = target < TimeScale ? 18f : 9f;
                TimeScale += (target - TimeScale) * (1f - M.Exp(-rate * dtR));
            }
            if (!_slowmoOn && TimeScale < 0.6f && _hitStop <= 0f)
            {
                _slowmoOn = true;
                Play("slowmo_in", 0f, 0.35f, 1f);
            }
            else if (_slowmoOn && TimeScale > 0.7f)
            {
                _slowmoOn = false;
            }
            float dt = dtR * TimeScale;
            Now += dt;
            _sinceGrenade += dtR;
            _sinceFruit += dtR;
            _shake = Math.Max(0f, _shake - dtR * 2.6f);
            if (_shake > 0f)
            {
                float k = _shake * _shake * 9f * S;
                _shakeX = Rng.Range(-k, k);
                _shakeY = Rng.Range(-k, k);
            }
            else
            {
                _shakeX = 0f;
                _shakeY = 0f;
            }

            if (_queue.Count > 0) StartNext();

            for (int gi = 0; gi < Grenades.Count; gi++)
            {
                Grenade g = Grenades[gi];
                bool hit = g.Update(dt);
                if (g.SpoonAttached && g.T > 0.12f)
                {
                    g.SpoonAttached = false;
                    Particle sp = Particles.Spawn(ParticleKind.Spoon);
                    sp.X = g.X;
                    sp.Y = g.Y;
                    sp.Vx = g.Vx * 0.6f + Rng.Range(-120f, 120f) * S;
                    sp.Vy = g.Vy * 0.5f - 200f * S;
                    sp.Gravity = 1400f * S;
                    sp.Spin = Rng.Range(-14f, 14f);
                    sp.Life = 4f;
                    sp.R = S * 1.05f;
                }
                if (!hit)
                {
                    if (Rng.Chance(0.7f)) Smoke.Puff(g.X, g.Y - 30f * S, 16f * S, 0.16f, -g.Vx * 0.15f, -g.Vy * 0.15f, 0.35f);
                    Smoke.Stir(g.X, g.Y, 50f * S, g.Vx, g.Vy, 0.5f);
                    if (Rng.Chance(0.5f))
                    {
                        Particles.Sparks(g.X + M.Sin(g.Angle) * 58f * 1.55f * S, g.Y - M.Cos(g.Angle) * 58f * 1.55f * S, 1, 260f * S, S, Rng);
                    }
                    Loop("fuse-" + g.Side, "fuse", Pan(g.Side) * g.T, 0.35f, Math.Max(0.5f, TimeScale));
                }
                else
                {
                    Detonate(g);
                }
            }
            Grenades.RemoveAll(delegate(Grenade g) { return g.Done; });

            foreach (Explosion e in Explosions)
            {
                e.Update(dt);
                foreach (Puff p in e.Puffs)
                {
                    PuffState st = e.State(p);
                    if (st.U > 0.45f && st.U < 0.95f && Rng.Chance(0.15f)) Smoke.Puff(st.X, st.Y, st.R * 0.6f, 0.11f, 0f, -40f * S, 0.8f);
                }
            }
            Explosions.RemoveAll(delegate(Explosion e) { return e.Done; });

            foreach (CannonBall c in Cannon)
            {
                c.Age += dt;
                c.Vy += 1700f * S * dt;
                c.X += c.Vx * dt;
                c.Y += c.Vy * dt;
                Smoke.Stir(c.X, c.Y, 40f * S, c.Vx, c.Vy, 0.4f);
                SlopLayer L = Layer(c.Side);
                if ((c.Side == Side.Left && c.X <= L.EdgeX + c.R * 0.6f) || (c.Side == Side.Right && c.X >= L.EdgeX - c.R * 0.6f))
                {
                    c.Done = true;
                    L.AddSplat(c.Y, 0.62f, Rng, Now, false, c.Message);
                    float inward = c.Side == Side.Left ? 1f : -1f;
                    for (int i = 0; i < 12; i++)
                    {
                        Particle p = Particles.Spawn(ParticleKind.Glob);
                        p.Message = c.Message;
                        float a = (inward > 0f ? 0f : M.PI) + Rng.Range(-1.2f, 1.2f);
                        float sp = Rng.Range(200f, 600f) * S;
                        p.X = c.X;
                        p.Y = c.Y;
                        p.Vx = M.Cos(a) * sp;
                        p.Vy = M.Sin(a) * sp - 150f * S;
                        p.R = Rng.Range(3f, 8f) * S;
                        p.Gravity = 1300f * S;
                        p.Life = 3f;
                        p.Pal = L.Pal;
                    }
                    _shake = Math.Max(_shake, 0.12f);
                    Play("splat", Pan(c.Side), 0.85f, 1f);
                }
            }
            Cannon.RemoveAll(delegate(CannonBall c) { return c.Done; });

            foreach (Emitter em in _emitters)
            {
                em.T -= dt;
                if (em.T <= 0f) Smoke.Puff(em.X, em.Y, 36f * S, em.Amount, em.Vx, em.Vy, em.Soot);
            }
            _emitters.RemoveAll(delegate(Emitter e) { return e.T <= 0f; });

            Particles.Update(dt, W, H, OnGlobStick);

            foreach (Fruit f in Fruits)
            {
                bool wasFlying = f.State == FruitState.Flying;
                f.Update(dt, W, H);
                if (wasFlying && f.State == FruitState.Flying)
                {
                    Smoke.Stir(f.X, f.Y, f.R * 1.4f, f.Vx, f.Vy, 0.6f);
                    if (Layer(f.Side).DensityAt(f.LeadX, f.Y) >= SlopLayer.GooIso * 1.05f) StickFruit(f);
                }
            }
            for (int i = Fruits.Count - 1; i >= 0; i--)
            {
                if (Fruits[i].State == FruitState.Gone)
                {
                    _activity.Add(FruitBounds(Fruits[i]));
                    Fruits[i].Dispose();
                    Fruits.RemoveAt(i);
                }
            }

            Left.Update(dt);
            Right.Update(dt);

            foreach (Squeegee q in Squeegees)
            {
                q.Update(dtR);
                SlopLayer L = Layer(q.Side);
                q.Pile += L.ScrapeAbove(q.Y);
                Flies.Scatter(q.Side, q.Y, Rng);
                foreach (Fruit f in Fruits)
                {
                    if (f.Side == q.Side && f.State == FruitState.Stuck && f.Y < q.Y)
                    {
                        f.State = FruitState.Falling;
                        f.Vx = (q.Side == Side.Left ? 1f : -1f) * Rng.Range(60f, 160f) * S;
                        f.Vy = -Rng.Range(80f, 220f) * S;
                    }
                }
                if (q.Done) L.Clear();
            }
            Squeegees.RemoveAll(delegate(Squeegee q) { return q.Done; });

            SpawnFlies(Left);
            SpawnFlies(Right);
            Flies.Update(dt, S, W, H, Rng, delegate(Side side, float y) { return Layer(side).SurfaceXAt(y); });
            UpdateBuzz(Side.Left);
            UpdateBuzz(Side.Right);

            foreach (Twinkle t in Twinkles) t.Update(dt);
            Twinkles.RemoveAll(delegate(Twinkle t) { return t.Done; });

            if (!Smoke.IsEmpty)
            {
                // the fluid is cheap but not free: step it at ~30 Hz when things are calm
                _smokeFrame++;
                if (!IsCalm || (_smokeFrame & 1) == 0) Smoke.Step(IsCalm ? dt * 2f : dt);
            }
        }

        private void SpawnFlies(SlopLayer L)
        {
            foreach (Splat sp in L.Splats)
            {
                float age = Now - sp.Born;
                if (age < Flies.Delay) continue;
                int want = Math.Min(sp.Size >= 0.9f ? 4 : 2, 1 + (int)Math.Floor((age - Flies.Delay) / 18f));
                if (Flies.CountFor(sp.Id, L.Side) < want && Flies.CanSpawn)
                {
                    Flies.Spawn(L.Side, sp.Id, L.EdgeX, sp.Y, W, H, Rng);
                    Flies.ArmCooldown(Rng);
                }
            }
        }

        private void UpdateBuzz(Side side)
        {
            int n = Flies.CountSide(side);
            Loop("buzz-" + side, n > 0 ? "buzz" : null, Pan(side), Math.Min(0.32f, 0.08f + n * 0.05f), 0.9f + n * 0.03f);
        }

        // ------------------------------------------------------------------ dirty tracking

        private RectangleF FruitBounds(Fruit f)
        {
            float r = _toon.Size * 0.62f;
            return new RectangleF(f.X - r, f.Y - r, r * 2f, r * 2f);
        }

        /// <summary>
        /// Adds this frame's moving content (and last frame's, so it gets erased)
        /// to `dirty`. Call after Update, before Render.
        /// </summary>
        public void CollectDirty(DirtyRegion dirty)
        {
            List<RectangleF> now = new List<RectangleF>();
            // generous padding so outlines, shake and motion never get clipped
            float sh = 14f * UI + 6f;
            foreach (Grenade g in Grenades)
            {
                float r = g.Radius + 90f * S;
                now.Add(new RectangleF(g.X - r, g.Y - r, r * 2f, r * 2f));
            }
            foreach (Explosion e in Explosions) now.Add(RectangleF.Inflate(e.Bounds, sh, sh));
            List<RectangleF> parts = new List<RectangleF>();
            Particles.AddBounds(W * 0.5f, parts);
            foreach (RectangleF pr in parts) now.Add(RectangleF.Inflate(pr, sh, sh));
            foreach (Fruit f in Fruits)
            {
                if (f.State != FruitState.Stuck || f.StuckT < 1.3f) now.Add(FruitBounds(f));
            }
            foreach (CannonBall c in Cannon)
            {
                float r = c.R * 1.6f + 130f * S;
                now.Add(new RectangleF(c.X - r, c.Y - r, r * 2f, r * 2f));
            }
            foreach (Twinkle t in Twinkles) now.Add(t.Bounds);
            foreach (Squeegee q in Squeegees) now.Add(q.Bounds(S));
            Flies.AddBounds(UI * 0.65f, now);
            AddSwirlActivity(Left, now);
            AddSwirlActivity(Right, now);
            if (!Smoke.IsEmpty || Smoke.Bx1 >= Smoke.Bx0) now.Add(SmokeScreenRect());
            foreach (RectangleF r in _activity) dirty.Add(r);
            foreach (RectangleF r in now) dirty.Add(r);
            _activity.Clear();
            _activity.AddRange(now);
            AddStripRows(Left, dirty);
            AddStripRows(Right, dirty);
        }

        private void AddSwirlActivity(SlopLayer L, List<RectangleF> now)
        {
            foreach (Swirl sw in L.Swirls)
            {
                if (sw.Age >= 1f) continue;
                float r = 120f * sw.Size;
                now.Add(new RectangleF(sw.X - r, sw.Y - r * 1.3f, r * 2f, r * 2.2f));
            }
        }

        private void AddStripRows(SlopLayer L, DirtyRegion dirty)
        {
            L.Flush(IsCalm ? 1200 : 700);
            int y0, y1;
            if (L.TakeDirtyRows(out y0, out y1)) dirty.Add(new RectangleF(L.StripX, y0, L.StripW, y1 - y0 + 1));
        }

        private RectangleF SmokeScreenRect()
        {
            if (Smoke.Bx1 < Smoke.Bx0) return new RectangleF(0f, 0f, 0f, 0f);
            float sx = (float)W / Smoke.Sprite.Width, sy = (float)H / Smoke.Sprite.Height;
            return RectangleF.FromLTRB((Smoke.Bx0 - 2) * sx, (Smoke.By0 - 2) * sy, (Smoke.Bx1 + 3) * sx, (Smoke.By1 + 3) * sy);
        }

        // ------------------------------------------------------------------ rendering

        /// <summary>Draws everything that intersects `clip` (the caller has cleared it).</summary>
        public void Render(Graphics g, Rectangle clip)
        {
            float s = S;
            // smoke (behind everything, re-rendered at ~30 Hz)
            if (!Smoke.IsEmpty && clip.IntersectsWith(Rectangle.Round(SmokeScreenRect())))
                Safe(g, "smoke", delegate { DrawSmoke(g); });
            Safe(g, "slop", delegate
            {
                DrawStrip(g, Left, clip);
                DrawStrip(g, Right, clip);
            });
            Safe(g, "swirls", delegate
            {
                Left.DrawSwirls(g);
                Right.DrawSwirls(g);
            });
            for (int pass = 0; pass < 2; pass++)
            {
                foreach (Fruit f in Fruits)
                {
                    bool stuck = f.State == FruitState.Stuck;
                    if ((pass == 0) != stuck) continue;
                    if (!clip.IntersectsWith(Rectangle.Round(FruitBounds(f)))) continue;
                    Fruit ff = f;
                    Safe(g, "fruit", delegate { DrawFruit(g, ff); });
                }
            }
            float sx = _shakeX, sy = _shakeY;
            foreach (CannonBall c in Cannon)
            {
                CannonBall cc = c;
                Safe(g, "cannon", delegate { g.TranslateTransform(sx, sy); DrawCannon(g, cc); });
            }
            foreach (Grenade gr in Grenades)
            {
                Grenade gg = gr;
                Safe(g, "grenade", delegate { g.TranslateTransform(sx, sy); DrawGrenade(g, gg); });
            }
            foreach (Explosion e in Explosions)
            {
                Explosion ee = e;
                Safe(g, "explosion", delegate { g.TranslateTransform(sx, sy); ee.Draw(g); });
            }
            Safe(g, "particles", delegate { g.TranslateTransform(sx, sy); Particles.Draw(g, s); });
            foreach (Twinkle t in Twinkles)
            {
                Twinkle tt = t;
                Safe(g, "twinkle", delegate { tt.Draw(g, UI); });
            }
            foreach (Squeegee q in Squeegees)
            {
                Squeegee qq = q;
                Safe(g, "squeegee", delegate { qq.Draw(g, s); });
            }
            // flies stay big enough to read as flies
            Safe(g, "flies", delegate { Flies.Draw(g, UI * 0.65f); });
        }

        /// <summary>
        /// Runs one drawing step with its own graphics state. If it fails, the state
        /// is still restored (so nothing after it is drawn rotated or shifted) and the
        /// error is logged; the effect simply skips that frame.
        /// </summary>
        private static void Safe(Graphics g, string what, Action draw)
        {
            GraphicsState st = null;
            try
            {
                st = g.Save();
                draw();
            }
            catch (Exception ex)
            {
                DrawLog.Report(what, ex);
            }
            finally
            {
                if (st != null)
                {
                    try { g.Restore(st); }
                    catch (Exception ex) { DrawLog.Report(what + " restore", ex); }
                }
            }
        }

        /// <summary>Re-render smoke pixels once per frame (call before Render).</summary>
        public void PrepareFrame()
        {
            if (!Smoke.IsEmpty && (IsCalm ? (_smokeFrame & 1) == 0 : true)) Smoke.Render();
            foreach (Fruit f in Fruits)
            {
                if (!f.NeedsRender) continue;
                if (f.Sprite == null) f.Sprite = new PixelSprite(_toon.Size, _toon.Size);
                f.UpdateRotation();
                _toon.Render(FruitModels.MeshFor(f.Kind), f.Rot, f.R, FruitModels.ShaderFor(f.Kind));
                Array.Copy(_toon.Out, f.Sprite.Pixels, _toon.Out.Length);
                f.RenderedAngle = f.Angle;
            }
        }

        private void DrawSmoke(Graphics g)
        {
            if (Smoke.Bx1 < Smoke.Bx0) return;
            RectangleF dst = SmokeScreenRect();
            float sx = (float)Smoke.Sprite.Width / W, sy = (float)Smoke.Sprite.Height / H;
            InterpolationMode im = g.InterpolationMode;
            PixelOffsetMode pm = g.PixelOffsetMode;
            g.InterpolationMode = InterpolationMode.Bilinear;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            Rectangle d = Rectangle.Round(dst);
            g.DrawImage(Smoke.Sprite.Bitmap, d, dst.X * sx, dst.Y * sy, dst.Width * sx, dst.Height * sy, GraphicsUnit.Pixel, _smokeAttrs);
            g.InterpolationMode = im;
            g.PixelOffsetMode = pm;
        }

        private static void DrawStrip(Graphics g, SlopLayer L, Rectangle clip)
        {
            if (L.IsEmpty && L.Blobs.Count == 0) return;
            Rectangle strip = new Rectangle(L.StripX, 0, L.StripW, L.ViewH);
            Rectangle r = Rectangle.Intersect(strip, clip);
            if (r.Width <= 0 || r.Height <= 0) return;
            g.DrawImage(L.Sprite.Bitmap, r, r.X - L.StripX, r.Y, r.Width, r.Height, GraphicsUnit.Pixel);
        }

        private void DrawFruit(Graphics g, Fruit f)
        {
            if (f.Sprite == null) return;
            int size = f.Sprite.Width;
            float sq = f.Squish;
            GraphicsState st = g.Save();
            g.TranslateTransform(f.X, f.Y);
            if (sq != 1f) g.ScaleTransform(sq, 2f - sq);
            g.DrawImage(f.Sprite.Bitmap, -size / 2, -size / 2, size, size);
            g.Restore(st);
            if (f.State == FruitState.Stuck)
            {
                SlopLayer L = Layer(f.Side);
                float inward = L.Inward;
                float k = M.Clamp01(f.StuckT / 0.25f);
                Ink.InkEllipse(g, f.X - inward * f.R * 0.78f, f.Y + f.R * 0.25f, f.R * 0.42f * k, f.R * 0.62f * k, inward * 0.25f, L.Pal.Base, 2.4f * S, 1f);
                Ink.FillEllipse(g, f.X - inward * f.R * 0.86f, f.Y + f.R * 0.05f, f.R * 0.12f * k, f.R * 0.2f * k, L.Pal.Light, 1f);
            }
        }

        private void DrawCannon(Graphics g, CannonBall c)
        {
            float sp = M.Len(c.Vx, c.Vy);
            float ang = M.Atan2(c.Vy, c.Vx);
            SlopPalette pal = Layer(c.Side).Pal;
            GraphicsState st = g.Save();
            g.TranslateTransform(c.X, c.Y);
            g.RotateTransform(ang * 57.2957795f);
            Pen trail = Ink.Pen(Palette.Ink, 2.5f * S, 0.5f);
            for (int i = -1; i <= 1; i++)
            {
                float o = i * 0.6f;
                g.DrawLine(trail, -c.R * 1.4f, o * c.R, -c.R * 1.4f - Math.Min(120f * S, sp * 0.08f), o * c.R);
            }
            RectangleF body = Ink.Rect(0f, 0f, c.R * 1.25f, c.R * 0.85f);
            g.FillEllipse(Ink.Brush(pal.Base, 1f), body);
            g.DrawEllipse(Ink.Pen(Palette.Ink, 3f * S, 1f), body);
            g.Restore(st);
            Ink.FillEllipseRot(g, c.X - c.R * 0.35f, c.Y - c.R * 0.35f, c.R * 0.4f, c.R * 0.22f, -0.6f, pal.Light, 1f);
        }

        private void DrawGrenade(Graphics g, Grenade gr)
        {
            float dx = gr.TargetX - gr.X, dy = gr.TargetY - gr.Y;
            float dl = M.Len(dx, dy); if (dl == 0f) dl = 1f;
            float sp = M.Len(gr.Vx, gr.Vy);
            if (sp > 1f)
            {
                float nx = gr.Vx / sp, ny = gr.Vy / sp;
                Pen p = Ink.Pen(Palette.Ink, 3f * S, 0.35f);
                for (int o = -1; o <= 1; o++)
                {
                    float px = gr.X - nx * 80f * S - ny * o * 30f * S;
                    float py = gr.Y - ny * 80f * S + nx * o * 30f * S;
                    float len = (50f - Math.Abs(o) * 15f) * S;
                    g.DrawLine(p, px, py, px - nx * len, py - ny * len);
                }
            }
            Grenade.Draw(g, gr.X, gr.Y, gr.Angle, 1.55f * S, gr.Pal, gr.UhOh, gr.SpoonAttached, gr.SparkPhase, dx / dl, dy / dl);
        }

        public void Dispose()
        {
            // stop looping voices (fuse hiss, fly buzz) so they do not outlive this world
            foreach (Side side in new Side[] { Side.Left, Side.Right })
            {
                Loop("fuse-" + side, null, 0f, 0f, 1f);
                Loop("buzz-" + side, null, 0f, 0f, 1f);
            }
            foreach (Fruit f in Fruits) f.Dispose();
            Left.Dispose();
            Right.Dispose();
            Smoke.Dispose();
            _smokeAttrs.Dispose();
        }
    }
}
