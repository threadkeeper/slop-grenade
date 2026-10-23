import type { AnimationTier, MessageDirection, MonitorSide } from './types';

/**
 * All 20 realistic, artistic fruit varieties randomly selected when an
 * `innocent_fruit` (40–59 mild AI slop) communication is detected.
 */
export const FRUIT_VARIETIES = [
  'honeycrisp_apple',
  'bartlett_pear',
  'valencia_orange',
  'amalfi_lemon',
  'ruby_strawberry',
  'bing_cherries',
  'crimson_watermelon',
  'golden_pineapple',
  'alphonso_mango',
  'emerald_kiwi',
  'red_dragonfruit',
  'concord_grapes',
  'sun_peach',
  'royal_plum',
  'ruby_pomegranate',
  'black_mission_fig',
  'tropical_papaya',
  'starfruit_carambola',
  'blueberries_cluster',
  'passionfruit_maracuja'
] as const;

export type FruitKind = (typeof FRUIT_VARIETIES)[number];

/**
 * Human-readable display names for the 20 fruit varieties.
 */
export const FRUIT_LABELS: Record<FruitKind, string> = {
  honeycrisp_apple: 'Honeycrisp Apple',
  bartlett_pear: 'Bartlett Pear',
  valencia_orange: 'Valencia Orange',
  amalfi_lemon: 'Amalfi Lemon',
  ruby_strawberry: 'Ruby Strawberry',
  bing_cherries: 'Twin Bing Cherries',
  crimson_watermelon: 'Crimson Watermelon',
  golden_pineapple: 'Golden Pineapple',
  alphonso_mango: 'Alphonso Mango',
  emerald_kiwi: 'Emerald Kiwi',
  red_dragonfruit: 'Red Dragonfruit',
  concord_grapes: 'Concord Grapes',
  sun_peach: 'Velvet Sun Peach',
  royal_plum: 'Royal Plum',
  ruby_pomegranate: 'Ruby Pomegranate',
  black_mission_fig: 'Black Mission Fig',
  tropical_papaya: 'Tropical Papaya',
  starfruit_carambola: 'Golden Starfruit',
  blueberries_cluster: 'Wild Blueberries',
  passionfruit_maracuja: 'Purple Passionfruit'
};

/**
 * Color palette family for poop-like dripping slop:
 * - `'brown_red'` for incoming slop received from colleagues (Left monitor edge)
 * - `'brown_blue'` for outgoing slop thrown by the user (Right monitor edge)
 */
export type SlopColorPalette = 'brown_red' | 'brown_blue';

export interface GoopBlob {
  offsetX: number;
  offsetY: number;
  baseRadius: number;
  squishFreq: number;
  squishPhase: number;
  slideRate: number;
  /** Primary rich sludge fill color */
  primaryColor: string;
  /** Secondary marbled highlight/midtone color */
  secondaryColor: string;
  /** Deep shadow/crust color */
  shadowColor: string;
  /** Lump rotation angle in radians */
  lumpAngle: number;
}

export interface GoopDrip {
  offsetX: number;
  originY: number;
  currentY: number;
  maxDropDistance: number;
  radius: number;
  slideSpeed: number;
  wobbleFreq: number;
  wobblePhase: number;
  color: string;
  highlightColor: string;
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
  color: string;
}

export type GrenadePhase = 'flight' | 'impact' | 'sliding_goop' | 'accumulated' | 'done';

export interface ActiveAnimation {
  id: number;
  tier: AnimationTier;
  side: MonitorSide;
  direction: MessageDirection;
  slopPalette: SlopColorPalette;
  score: number;
  sender: string;
  subject: string;
  elapsed: number;
  duration: number;
  /** Whether this animation persists and builds up on the monitor bezel until squeegeed */
  persistentSlop: boolean;
  // Coordinates
  startX: number;
  startY: number;
  impactX: number;
  impactY: number;
  currentX: number;
  currentY: number;
  rotation: number;
  // Grenade & Goop physics state
  phase: GrenadePhase;
  slideDistance: number;
  maxSlideDistance: number;
  shakeIntensity: number;
  blobs: GoopBlob[];
  drips: GoopDrip[];
  bubbles: GoopBubble[];
  // Peaceful / Human particles & 20-Fruit variety
  sparkles: SparkleParticle[];
  fruitKind: FruitKind;
}

/**
 * State for an active Squeegee wipe animation clearing one side of the monitor.
 */
export interface SqueegeeWipe {
  side: MonitorSide;
  currentY: number;
  viewportHeight: number;
  speed: number;
  done: boolean;
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

const PLASTIC_PINK_SWATCHES: Array<[string, string, string]> = [
  ['#ff2e93', '#ff6bb5', '#a30b52'], // Glossy vinyl plastic pink
  ['#f01c82', '#ff5cad', '#8f0847'], // Hot bubblegum plastic pink
  ['#ff429e', '#ff85c2', '#b3125d'], // Bright magenta-pink plastic
  ['#e6197a', '#ff66b2', '#820640'], // Deep berry-pink vinyl
  ['#ff3898', '#ff78bd', '#990d4d'] // Neon coral-pink plastic
];

const PLASTIC_BLUE_SWATCHES: Array<[string, string, string]> = [
  ['#0096ff', '#5cc2ff', '#00488a'], // Glossy vinyl plastic blue
  ['#007be6', '#38b6ff', '#003a70'], // Electric cobalt plastic blue
  ['#1aa3ff', '#70ccff', '#005299'], // Toy cyan-blue plastic
  ['#0084f0', '#4dbdff', '#003f7a'], // Vivid azure vinyl
  ['#0d9eff', '#66c7ff', '#004c8f'] // Bright sky-plastic blue
];

/**
 * Pick one of the 20 realistic fruit varieties.
 */
export function pickFruitVariety(randomFn: () => number = Math.random): FruitKind {
  const idx = Math.floor(randomFn() * FRUIT_VARIETIES.length) % FRUIT_VARIETIES.length;
  return FRUIT_VARIETIES[Math.max(0, idx)];
}

/**
 * Create a new physics animation instance for any of the 5 Slop Grenade tiers.
 */
export function createAnimationInstance(params: {
  id: number;
  tier: AnimationTier;
  side: MonitorSide;
  direction?: MessageDirection;
  score: number;
  sender: string;
  subject: string;
  viewportWidth: number;
  viewportHeight: number;
  fruitKindOverride?: FruitKind;
  useRandomFruit?: boolean;
}): ActiveAnimation {
  const {
    id,
    tier,
    side,
    score,
    sender,
    subject,
    viewportWidth,
    viewportHeight,
    fruitKindOverride,
    useRandomFruit = true
  } = params;

  const direction: MessageDirection =
    params.direction ?? (side === 'right' ? 'sent' : 'received');
  const slopPalette: SlopColorPalette =
    direction === 'sent' || side === 'right' ? 'brown_blue' : 'brown_red';

  const rand = seededRandom(id * 131 + score * 17 + (side === 'left' ? 7 : 23));
  const swatches =
    slopPalette === 'brown_blue' ? PLASTIC_BLUE_SWATCHES : PLASTIC_PINK_SWATCHES;

  const impactX = side === 'left' ? 14 : Math.max(40, viewportWidth - 14);
  const impactY = Math.round(viewportHeight * (0.06 + rand() * 0.86));
  const startX = Math.round(viewportWidth * 0.5 + (side === 'left' ? 140 : -140));
  const startY = Math.round(viewportHeight * 0.82);

  const blobs: GoopBlob[] = [];
  const drips: GoopDrip[] = [];
  const bubbles: GoopBubble[] = [];
  const sparkles: SparkleParticle[] = [];

  // Every animation type sticks to the monitor edge until squeegeed!
  let duration = 3.2;
  const persistentSlop = true;
  let maxSlideDistance = 0;

  if (tier === 'slop_grenade') {
    duration = 6.0;
    maxSlideDistance = 42 + rand() * 54;
    const inward = side === 'left' ? 1 : -1;

    for (let i = 0; i < 10; i++) {
      const [primaryColor, secondaryColor, shadowColor] =
        swatches[Math.floor(rand() * swatches.length)];
      blobs.push({
        offsetX: inward * (rand() * 24),
        offsetY: (rand() - 0.45) * 44,
        baseRadius: 6 + rand() * 10,
        squishFreq: 3.5 + rand() * 4.0,
        squishPhase: rand() * Math.PI * 2,
        slideRate: 10 + rand() * 14,
        primaryColor,
        secondaryColor,
        shadowColor,
        lumpAngle: (rand() - 0.5) * 0.7
      });
    }

    for (let i = 0; i < 6; i++) {
      const originOffset = (rand() - 0.3) * 32;
      const [primaryColor, secondaryColor] = swatches[Math.floor(rand() * swatches.length)];
      drips.push({
        offsetX: inward * (2 + rand() * 20),
        originY: impactY + originOffset,
        currentY: impactY + originOffset,
        maxDropDistance: 36 + rand() * 72,
        radius: 3.5 + rand() * 5.0,
        slideSpeed: 16 + rand() * 28,
        wobbleFreq: 2.5 + rand() * 3.5,
        wobblePhase: rand() * Math.PI * 2,
        color: i % 2 === 0 ? primaryColor : secondaryColor,
        highlightColor: 'rgba(255, 255, 255, 0.65)'
      });
    }

    for (let i = 0; i < 6; i++) {
      bubbles.push({
        offsetX: inward * (3 + rand() * 20),
        offsetY: (rand() - 0.4) * 36,
        radius: 1.8 + rand() * 3.2,
        popTime: 2.0 + rand() * 7.0
      });
    }
  } else if (tier === 'slop_splat') {
    duration = 4.5;
    maxSlideDistance = 24 + rand() * 32;
    const inward = side === 'left' ? 1 : -1;

    for (let i = 0; i < 7; i++) {
      const [primaryColor, secondaryColor, shadowColor] =
        swatches[Math.floor(rand() * swatches.length)];
      blobs.push({
        offsetX: inward * (rand() * 18),
        offsetY: (rand() - 0.5) * 28,
        baseRadius: 5 + rand() * 7,
        squishFreq: 4.5 + rand() * 3.5,
        squishPhase: rand() * Math.PI * 2,
        slideRate: 8 + rand() * 10,
        primaryColor,
        secondaryColor,
        shadowColor,
        lumpAngle: (rand() - 0.5) * 0.6
      });
    }

    for (let i = 0; i < 4; i++) {
      const [primaryColor, secondaryColor] = swatches[Math.floor(rand() * swatches.length)];
      drips.push({
        offsetX: inward * (2 + rand() * 14),
        originY: impactY,
        currentY: impactY,
        maxDropDistance: 24 + rand() * 48,
        radius: 2.8 + rand() * 3.8,
        slideSpeed: 12 + rand() * 18,
        wobbleFreq: 3.5,
        wobblePhase: rand() * Math.PI * 2,
        color: i % 2 === 0 ? primaryColor : secondaryColor,
        highlightColor: 'rgba(255, 255, 255, 0.6)'
      });
    }
  } else if (tier === 'innocent_fruit') {
    duration = 2.4;
    const inward = side === 'left' ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      sparkles.push({
        x: impactX + inward * 16,
        y: impactY,
        vx: inward * (10 + rand() * 22),
        vy: -20 - rand() * 24,
        size: 1.8 + rand() * 2.0,
        alpha: 0.85,
        twinklePhase: rand() * Math.PI * 2,
        color: '#fde047'
      });
    }
  } else if (tier === 'peaceful_cloud') {
    duration = 2.4;
  } else {
    // 'human_sparkle': small sparkles that settle into the edge buildup
    duration = 2.2;
    const inward = side === 'left' ? 1 : -1;
    for (let i = 0; i < 10; i++) {
      sparkles.push({
        x: impactX + inward * (4 + rand() * 18),
        y: impactY + (rand() - 0.5) * 26,
        vx: inward * (2 + rand() * 5) + (rand() - 0.5) * 4,
        vy: -8 - rand() * 12,
        size: 1.4 + rand() * 1.8,
        alpha: 0.32 + rand() * 0.28,
        twinklePhase: rand() * Math.PI * 2,
        color: '#fde68a'
      });
    }
  }

  const fruitKind: FruitKind =
    fruitKindOverride ??
    (useRandomFruit
      ? pickFruitVariety(Math.random)
      : FRUIT_VARIETIES[(id - 1) % FRUIT_VARIETIES.length]);

  const initialX =
    tier === 'slop_grenade'
      ? startX
      : tier === 'innocent_fruit'
        ? impactX + (side === 'left' ? 135 : -135)
        : tier === 'peaceful_cloud'
          ? impactX + (side === 'left' ? 145 : -145)
          : impactX;

  return {
    id,
    tier,
    side,
    direction,
    slopPalette,
    score,
    sender,
    subject,
    elapsed: 0,
    duration,
    persistentSlop,
    startX,
    startY,
    impactX,
    impactY,
    currentX: initialX,
    currentY: tier === 'slop_grenade' ? startY : impactY,
    rotation: 0,
    phase: tier === 'slop_grenade' ? 'flight' : 'sliding_goop',
    slideDistance: 0,
    maxSlideDistance,
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

  if (!anim.persistentSlop && anim.elapsed >= anim.duration) {
    anim.phase = 'done';
    anim.shakeIntensity = 0;
    return anim;
  }

  if (anim.tier === 'slop_grenade') {
    const flightDuration = 0.65;
    const impactFlashDuration = 0.28;

    if (anim.elapsed < flightDuration) {
      anim.phase = 'flight';
      const t = anim.elapsed / flightDuration;
      // Parabolic ballistic arc toward monitor edge
      anim.currentX = anim.startX + (anim.impactX - anim.startX) * t;
      const linearY = anim.startY + (anim.impactY - anim.startY) * t;
      const arcLift = -195 * 4 * t * (1 - t);
      anim.currentY = linearY + arcLift;
      anim.rotation = t * Math.PI * 5.2 * (anim.side === 'left' ? -1 : 1);
      anim.shakeIntensity = 0;
    } else if (anim.elapsed < flightDuration + impactFlashDuration) {
      anim.phase = 'impact';
      anim.currentX = anim.impactX;
      anim.currentY = anim.impactY;
      const impactT = (anim.elapsed - flightDuration) / impactFlashDuration;
      anim.shakeIntensity = (1 - impactT) * 15;
    } else {
      anim.currentX = anim.impactX;
      anim.shakeIntensity = 0;

      if (anim.slideDistance < anim.maxSlideDistance && anim.elapsed < anim.duration) {
        anim.phase = 'sliding_goop';
        const viscosityDamping = Math.max(
          0.25,
          1 - anim.slideDistance / (anim.maxSlideDistance * 1.15)
        );
        anim.slideDistance += 42 * viscosityDamping * dt;
      } else {
        anim.phase = 'accumulated';
        anim.slideDistance += 0.8 * dt;
      }
      anim.currentY = anim.impactY + anim.slideDistance;

      for (const drip of anim.drips) {
        const currentDrop = drip.currentY - drip.originY;
        if (currentDrop < drip.maxDropDistance) {
          const dripFactor = Math.max(0.15, 1 - currentDrop / (drip.maxDropDistance * 1.1));
          drip.currentY += drip.slideSpeed * dripFactor * dt;
        } else {
          drip.currentY += 0.5 * dt;
        }
      }
    }
  } else if (anim.tier === 'slop_splat') {
    if (anim.slideDistance < anim.maxSlideDistance) {
      anim.phase = 'sliding_goop';
      anim.slideDistance += 18 * dt;
    } else {
      anim.phase = 'accumulated';
      anim.slideDistance += 0.5 * dt;
    }
    anim.currentY = anim.impactY + anim.slideDistance;
    for (const drip of anim.drips) {
      const currentDrop = drip.currentY - drip.originY;
      if (currentDrop < drip.maxDropDistance) {
        drip.currentY += drip.slideSpeed * dt;
      }
    }
  } else if (anim.tier === 'innocent_fruit') {
    const inward = anim.side === 'left' ? 1 : -1;
    if (anim.elapsed < anim.duration) {
      anim.phase = 'sliding_goop';
      const t = anim.elapsed / anim.duration;
      // Bounces in toward the edge and sticks into the slop buildup!
      const dist = 54 * (1 - t * 0.72) + Math.sin(anim.elapsed * 5.0) * 8 * (1 - t);
      anim.currentX = anim.impactX + inward * dist;
      anim.currentY = anim.impactY - Math.abs(Math.sin(anim.elapsed * 4.2)) * 22 * (1 - t);
      for (const sp of anim.sparkles) {
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 65 * dt;
      }
    } else {
      anim.phase = 'accumulated';
      anim.currentX = anim.impactX + inward * 14;
    }
  } else if (anim.tier === 'peaceful_cloud') {
    const inward = anim.side === 'left' ? 1 : -1;
    if (anim.elapsed < anim.duration) {
      anim.phase = 'sliding_goop';
      const t = anim.elapsed / anim.duration;
      anim.currentX = anim.impactX + inward * (64 * (1 - t * 0.75));
      anim.currentY = anim.impactY + Math.sin(anim.elapsed * 2.2) * 5 * (1 - t);
    } else {
      anim.phase = 'accumulated';
      anim.currentX = anim.impactX + inward * 16;
    }
  } else {
    // 'human_sparkle': gentle rising sparkle plume that sticks to the slop on the bezel
    if (anim.elapsed < anim.duration) {
      anim.phase = 'sliding_goop';
      for (const sp of anim.sparkles) {
        sp.x += sp.vx * dt * 0.4 + Math.sin(anim.elapsed * 3 + sp.twinklePhase) * 0.2;
        sp.y += sp.vy * dt * 0.4;
      }
    } else {
      anim.phase = 'accumulated';
    }
  }

  return anim;
}

/**
 * Create a new Squeegee wipe animation for the left or right side of the monitor.
 */
export function createSqueegeeWipe(side: MonitorSide, viewportHeight: number): SqueegeeWipe {
  return {
    side,
    currentY: -40,
    viewportHeight,
    speed: Math.max(680, viewportHeight * 0.95),
    done: false
  };
}

/**
 * Advance a Squeegee wipe downwards and remove any accumulated slop on that side
 * that the rubber squeegee blade has scraped past.
 */
export function stepSqueegeeWipe(
  wipe: SqueegeeWipe,
  animations: ActiveAnimation[],
  dtSeconds: number
): { wipe: SqueegeeWipe; remaining: ActiveAnimation[] } {
  const dt = Math.max(0, Math.min(dtSeconds, 0.25));
  wipe.currentY += wipe.speed * dt;
  if (wipe.currentY >= wipe.viewportHeight + 80) {
    wipe.done = true;
  }

  const remaining = animations.filter((anim) => {
    if (anim.side !== wipe.side) return true;
    if (!anim.persistentSlop) return true;
    return anim.currentY > wipe.currentY + 24;
  });

  return { wipe, remaining };
}
