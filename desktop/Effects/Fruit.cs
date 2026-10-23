// Fruit.cs
// A 3D fruit tossed across the screen, tumbling about a random axis.
// It only sticks when it actually hits slop on the edge; otherwise it sails off.
// Mirrors web/src/lib/engine/fruit.ts.

using System;

namespace SlopGrenadeDesktop
{
    internal enum FruitState
    {
        Flying,
        Stuck,
        Falling,
        Gone
    }

    internal sealed class Fruit : IDisposable
    {
        public readonly int Kind;
        public readonly Side Side;
        public float X, Y, Vx, Vy, Angle, StuckT;
        public readonly float Gravity, Ax, Ay, Az, Omega, R;
        public FruitState State = FruitState.Flying;
        public float RenderedAngle = float.NaN;
        public readonly float[] Base = new float[9];
        public readonly float[] Rot = new float[9];
        private readonly float[] _tmp = new float[9];
        public PixelSprite Sprite;

        public Fruit(int kind, Side side, int viewW, int viewH, float s, Rng rng, float targetY)
        {
            Kind = kind;
            Side = side;
            R = 46f * s;
            float inward = side == Side.Left ? 1f : -1f;
            float edge = side == Side.Left ? 0f : viewW;
            X = viewW * 0.5f + inward * viewW * rng.Range(0.05f, 0.35f);
            Y = viewH + R * 1.6f;
            float T = rng.Range(1.5f, 2.1f);
            Gravity = 1100f * s;
            float tx = edge - inward * R * 0.2f;
            Vx = (tx - X) / T;
            Vy = (targetY - Y - 0.5f * Gravity * T * T) / T;
            float z = rng.Range(-1f, 1f);
            float t = rng.Range(0f, M.TAU);
            float r = M.Sqrt(1f - z * z);
            Ax = r * M.Cos(t);
            Ay = r * M.Sin(t);
            Az = z;
            Omega = rng.Range(2.2f, 4f) * rng.Sign();
            Toon.AxisAngle(0f, 1f, 0f, rng.Range(0f, M.TAU), _tmp);
            Toon.AxisAngle(1f, 0f, 0f, rng.Range(-0.7f, 0.7f), Base);
            Toon.Mul3(Base, _tmp, Base);
            UpdateRotation();
        }

        public void UpdateRotation()
        {
            Toon.AxisAngle(Ax, Ay, Az, Angle, _tmp);
            Toon.Mul3(_tmp, Base, Rot);
        }

        public float LeadX { get { return X - (Side == Side.Left ? 1f : -1f) * R * 0.82f; } }

        public float Squish
        {
            get
            {
                if (State != FruitState.Stuck) return 1f;
                return 1f + 0.16f * M.Exp(-5f * StuckT) * M.Sin(StuckT * 19f);
            }
        }

        public void Update(float dt, int viewW, int viewH)
        {
            if (State == FruitState.Flying)
            {
                Vy += Gravity * dt;
                X += Vx * dt;
                Y += Vy * dt;
                Angle += Omega * dt;
                if (X < -R * 1.6f || X > viewW + R * 1.6f || Y > viewH + R * 3f) State = FruitState.Gone;
            }
            else if (State == FruitState.Stuck)
            {
                StuckT += dt;
            }
            else if (State == FruitState.Falling)
            {
                Vy += 1500f * (R / 46f) * dt;
                X += Vx * dt;
                Y += Vy * dt;
                Angle += Omega * 6f * dt;
                if (Y > viewH + R * 2f) State = FruitState.Gone;
            }
        }

        public bool NeedsRender { get { return float.IsNaN(RenderedAngle) || Math.Abs(Angle - RenderedAngle) > 0.045f; } }

        public void Dispose()
        {
            if (Sprite != null) { Sprite.Dispose(); Sprite = null; }
        }
    }
}
