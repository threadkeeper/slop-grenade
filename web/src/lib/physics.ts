import type { AnimationTier, MonitorSide } from './types';

export interface GoopBlob {
  offsetX: number;
  offsetY: number;
  baseRadius: number;
  squishFreq: number;
  squishPhase: number;
  slideRate: number;
  hue: number;
}

export interface GoopDrip {
  offsetX: number;
  originY: number;
  currentY: number;
  radius: number;
  slideSpeed: number;
  wobbleFreq: number;
  wobblePhase: number;
}

export interface GoopBubble {
  offsetX: number;
  offsetY: number;
  radius: number;
  popTime: number;
}

export interface SparkleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  twinklePhase: number;
}

export type GrenadePhase = 'flight' | 'impact' | 'sliding_goop' | 'done';

export interface ActiveAnimation {
  id: number;
  tier: AnimationTier;
  side: MonitorSide;
  score: number;
  sender: string;
  subject: string;
  elapsed: number;
  duration: number;
  // Coordinates
  startX: number;
  startY: number;
  impactX: number;
  impactY: number;
  currentX: number;
  currentY: number;
  rotation: number;
  // Grenade & Goop physics state
  phase: 'flight' | 'impact' | 'sliding_goop' | 'done';
  slideDistance: number;
  shakeIntensity: number;
  blobs: GoopBlob[];
  drips: GoopDrip[];
  bubbles: GoopBubble[];
  // Peaceful / Human particles
  sparkles: SparkleParticle[];
  fruitKind: 'peach' | 'lemon' | 'berry';
}

/**
 * Deterministic PRNG helper so tests and animations are reproducible.
 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Create a new physics animation instance for any of the 5 Slop Grenade tiers.
 */
export function createAnimationInstance(params: {
  id: number;
  tier: AnimationTier;
  side: MonitorSide;
  score: number;
  sender: string;
  subject: string;
  viewportWidth: number;
  viewportHeight: number;
}): ActiveAnimation {
  const { id, tier, side, score, sender, subject, viewportWidth, viewportHeight } = params;
  const rand = seededRandom(id * 97 + score);

  const impactX = side === 'left' ? 28 : Math.max(80, viewportWidth - 28);
  const impactY = Math.round(viewportHeight * (0.24 + rand() * 0.22));
  const startX = Math.round(viewportWidth * 0.5 + (side === 'left' ? 140 : -140));
  const startY = Math.round(viewportHeight * 0.82);

  const blobs: GoopBlob[] = [];
  const drips: GoopDrip[] = [];
  const bubbles: GoopBubble[] = [];
  const sparkles: SparkleParticle[] = [];

  let duration = 3.2;

  if (tier === 'slop_grenade') {
    duration = 8.5;
    const inward = side === 'left' ? 1 : -1;
    for (let i = 0; i < 14; i++) {
      blobs.push({
        offsetX: inward * (rand() * 54),
        offsetY: (rand() - 0.45) * 92,
        baseRadius: 16 + rand() * 26,
        squishFreq: 4 + rand() * 5,
        squishPhase: rand() * Math.PI * 2,
        slideRate: 26 + rand() * 34,
        hue: 74 + Math.round(rand() * 32) // toxic chartreuse-lime shades
      });
    }
    for (let i = 0; i < 9; i++) {
      const originOffset = (rand() - 0.3) * 60;
      drips.push({
        offsetX: inward * (4 + rand() * 48),
        originY: impactY + originOffset,
        currentY: impactY + originOffset,
        radius: 7 + rand() * 11,
        slideSpeed: 38 + rand() * 68,
        wobbleFreq: 3 + rand() * 4,
        wobblePhase: rand() * Math.PI * 2
      });
    }
    for (let i = 0; i < 12; i++) {
      bubbles.push({
        offsetX: inward * (6 + rand() * 44),
        offsetY: (rand() - 0.4) * 80,
        radius: 3 + rand() * 6,
        popTime: 1.4 + rand() * 5.5
      });
    }
  } else if (tier === 'slop_splat') {
    duration = 4.8;
    const inward = side === 'left' ? 1 : -1;
    for (let i = 0; i < 7; i++) {
      blobs.push({
        offsetX: inward * (rand() * 32),
        offsetY: (rand() - 0.5) * 48,
        baseRadius: 11 + rand() * 15,
        squishFreq: 6 + rand() * 4,
        squishPhase: rand() * Math.PI * 2,
        slideRate: 14 + rand() * 16,
        hue: 48 + Math.round(rand() * 28)
      });
    }
    for (let i = 0; i < 4; i++) {
      drips.push({
        offsetX: inward * (4 + rand() * 24),
        originY: impactY,
        currentY: impactY,
        radius: 5 + rand() * 6,
        slideSpeed: 22 + rand() * 25,
        wobbleFreq: 4,
        wobblePhase: rand() * Math.PI * 2
      });
    }
  } else if (tier === 'innocent_fruit') {
    duration = 3.8;
    const inward = side === 'left' ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      sparkles.push({
        x: impactX + inward * 36,
        y: impactY,
        vx: inward * (18 + rand() * 42),
        vy: -35 - rand() * 40,
        size: 3 + rand() * 3,
        alpha: 0.75,
        twinklePhase: rand() * Math.PI * 2
      });
    }
  } else if (tier === 'peaceful_cloud') {
    duration = 4.4;
  } else {
    // 'human_sparkle': small, barely visible plumes of sparkles
    duration = 2.8;
    const inward = side === 'left' ? 1 : -1;
    const baseY = Math.round(viewportHeight * 0.72);
    for (let i = 0; i < 16; i++) {
      sparkles.push({
        x: impactX + inward * (8 + rand() * 26),
        y: baseY + (rand() - 0.5) * 44,
        vx: inward * (3 + rand() * 10) + (rand() - 0.5) * 6,
        vy: -18 - rand() * 26,
        size: 1.5 + rand() * 2.4,
        alpha: 0.16 + rand() * 0.24, // Subtle, barely visible plume!
        twinklePhase: rand() * Math.PI * 2
      });
    }
  }

  const fruits: Array<'peach' | 'lemon' | 'berry'> = ['peach', 'lemon', 'berry'];
  const fruitKind = fruits[id % fruits.length];

  return {
    id,
    tier,
    side,
    score,
    sender,
    subject,
    elapsed: 0,
    duration,
    startX,
    startY,
    impactX,
    impactY,
    currentX: tier === 'slop_grenade' ? startX : impactX,
    currentY: tier === 'slop_grenade' ? startY : impactY,
    rotation: 0,
    phase: tier === 'slop_grenade' ? 'flight' : 'sliding_goop',
    slideDistance: 0,
    shakeIntensity: 0,
    blobs,
    drips,
    bubbles,
    sparkles,
    fruitKind
  };
}

/**
 * Step an active animation forward by `dtSeconds` and update its physics state.
 */
export function stepAnimation(anim: ActiveAnimation, dtSeconds: number): ActiveAnimation {
  const dt = Math.max(0, Math.min(dtSeconds, 0.25));
  anim.elapsed += dt;

  if (anim.elapsed >= anim.duration) {
    anim.phase = 'done';
    anim.shakeIntensity = 0;
    return anim;
  }

  if (anim.tier === 'slop_grenade') {
    const flightDuration = 0.62;
    const impactFlashDuration = 0.28;

    if (anim.elapsed < flightDuration) {
      anim.phase = 'flight';
      const t = anim.elapsed / flightDuration;
      // Parabolic ballistic arc toward monitor edge
      anim.currentX = anim.startX + (anim.impactX - anim.startX) * t;
      const linearY = anim.startY + (anim.impactY - anim.startY) * t;
      const arcLift = -190 * 4 * t * (1 - t);
      anim.currentY = linearY + arcLift;
      anim.rotation = t * Math.PI * 5.5 * (anim.side === 'left' ? -1 : 1);
      anim.shakeIntensity = 0;
    } else if (anim.elapsed < flightDuration + impactFlashDuration) {
      anim.phase = 'impact';
      anim.currentX = anim.impactX;
      anim.currentY = anim.impactY;
      const impactT = (anim.elapsed - flightDuration) / impactFlashDuration;
      anim.shakeIntensity = (1 - impactT) * 14;
    } else {
      anim.phase = 'sliding_goop';
      anim.currentX = anim.impactX;
      anim.shakeIntensity = 0;
      // Viscous goop mass slowly slides down the side of the monitor
      const slideDt = dt;
      anim.slideDistance += 34 * slideDt;
      anim.currentY = anim.impactY + anim.slideDistance;

      for (const drip of anim.drips) {
        drip.currentY += drip.slideSpeed * slideDt;
      }
    }
  } else if (anim.tier === 'slop_splat') {
    anim.slideDistance += 16 * dt;
    anim.currentY = anim.impactY + anim.slideDistance;
    for (const drip of anim.drips) {
      drip.currentY += drip.slideSpeed * dt;
    }
  } else if (anim.tier === 'innocent_fruit') {
    const inward = anim.side === 'left' ? 1 : -1;
    const bounceT = anim.elapsed;
    anim.currentX = anim.impactX + inward * (34 + Math.sin(bounceT * 2.2) * 18);
    anim.currentY = anim.impactY - Math.abs(Math.sin(bounceT * 4.2)) * 38;
    for (const sp of anim.sparkles) {
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 90 * dt;
    }
  } else if (anim.tier === 'peaceful_cloud') {
    const inward = anim.side === 'left' ? 1 : -1;
    anim.currentX = anim.impactX + inward * (44 + anim.elapsed * 22);
    anim.currentY = anim.impactY + Math.sin(anim.elapsed * 1.8) * 8;
  } else {
    // 'human_sparkle': gentle rising sparkle plume
    for (const sp of anim.sparkles) {
      sp.x += sp.vx * dt + Math.sin(anim.elapsed * 3 + sp.twinklePhase) * 0.3;
      sp.y += sp.vy * dt;
    }
  }

  return anim;
}
