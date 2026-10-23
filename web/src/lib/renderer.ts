import {
  FRUIT_LABELS,
  type ActiveAnimation,
  type FruitKind,
  type SqueegeeWipe
} from './physics';

/**
 * Render all active animations, accumulated side slop, and active squeegee wipes
 * onto the full-viewport monitor overlay canvas.
 */
export function renderAnimations(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  animations: ActiveAnimation[],
  squeegeeWipes: SqueegeeWipe[] = []
): void {
  ctx.clearRect(0, 0, width, height);

  for (const anim of animations) {
    if (anim.phase === 'done') continue;
    const progress = anim.elapsed / anim.duration;
    // Persistent slop (Slop Grenades & Slop Splats) NEVER fades out on its own—
    // it builds up on each side of the monitor until cleared with the squeegee!
    const fadeOut = anim.persistentSlop
      ? 1
      : progress > 0.78
        ? Math.max(0, 1 - (progress - 0.78) / 0.22)
        : 1;

    ctx.save();
    if (anim.shakeIntensity > 0) {
      const dx = (Math.random() - 0.5) * anim.shakeIntensity;
      const dy = (Math.random() - 0.5) * anim.shakeIntensity;
      ctx.translate(dx, dy);
    }

    if (anim.tier === 'slop_grenade') {
      drawSlopGrenade(ctx, anim, fadeOut);
    } else if (anim.tier === 'slop_splat') {
      drawPoopSlopSplat(ctx, anim, fadeOut, false);
    } else if (anim.tier === 'innocent_fruit') {
      drawArtisticFruit(ctx, anim, fadeOut);
    } else if (anim.tier === 'peaceful_cloud') {
      drawPeacefulCloud(ctx, anim, fadeOut);
    } else {
      drawHumanSparkles(ctx, anim, fadeOut);
    }

    ctx.restore();
  }

  for (const wipe of squeegeeWipes) {
    if (!wipe.done) {
      drawSqueegeeWipe(ctx, width, wipe);
    }
  }
}

/**
 * Renders a realistic dull metallic slate-blue Mk2 fragmentation pineapple hand grenade
 * in flight, followed by impact shockwave and thick dripping poop-like sludge.
 */
function drawSlopGrenade(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number
): void {
  if (anim.phase === 'flight') {
    // 1. Ballistic smoke & ember arc trail
    ctx.save();
    ctx.strokeStyle =
      anim.slopPalette === 'brown_blue'
        ? 'rgba(110, 142, 178, 0.55)'
        : 'rgba(168, 92, 74, 0.55)';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(anim.startX, anim.startY);
    ctx.quadraticCurveTo(
      (anim.startX + anim.impactX) * 0.5,
      Math.min(anim.startY, anim.impactY) - 190,
      anim.currentX,
      anim.currentY
    );
    ctx.stroke();
    ctx.restore();

    // 2. Realistic dull metallic blue Mk2 Pineapple Hand Grenade (scaled 1.35x for crisp visibility)
    ctx.save();
    ctx.translate(anim.currentX, anim.currentY);
    ctx.rotate(anim.rotation);
    ctx.scale(1.35, 1.35);

    // Subtle smoky aura around the live grenade
    const aura = ctx.createRadialGradient(0, 0, 8, 0, 0, 48);
    aura.addColorStop(0, 'rgba(71, 98, 128, 0.48)');
    aura.addColorStop(0.6, 'rgba(42, 58, 77, 0.22)');
    aura.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.fill();

    // Cast gunmetal-blue base body (ovoid Mk2 silhouette)
    const bodyGrad = ctx.createRadialGradient(-9, -6, 4, 0, 4, 34);
    bodyGrad.addColorStop(0, '#6e88a4'); // Dull brushed steel-blue highlight
    bodyGrad.addColorStop(0.38, '#465d75'); // Mid weathered slate-blue
    bodyGrad.addColorStop(0.78, '#2b3b4d'); // Deep gunmetal blue
    bodyGrad.addColorStop(1, '#18222e'); // Cast-iron crevice shadow

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#16202b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 5, 23, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3D Raised Waffle / Pineapple Fragmentation Segments (4 rows × 4 columns)
    const rowYs = [-13, -3, 7, 17];
    const colXs = [-13, -4, 5, 13];
    for (let r = 0; r < rowYs.length; r++) {
      const ry = rowYs[r];
      const rowScale = r === 0 || r === 3 ? 0.82 : 1.0;
      for (let c = 0; c < colXs.length - 1; c++) {
        const cx = ((colXs[c] + colXs[c + 1]) * 0.5) * rowScale;
        const bw = 7.2 * rowScale;
        const bh = 7.8;

        // Dark recessed trench around segment
        ctx.fillStyle = '#17212c';
        ctx.beginPath();
        ctx.roundRect(cx - bw * 0.5 - 0.8, ry - bh * 0.5 - 0.8, bw + 1.6, bh + 1.6, 2.2);
        ctx.fill();

        // Raised dull metallic blue pillow block
        const segGrad = ctx.createLinearGradient(cx - bw * 0.5, ry - bh * 0.5, cx + bw * 0.5, ry + bh * 0.5);
        segGrad.addColorStop(0, '#7893b0');
        segGrad.addColorStop(0.45, '#435b73');
        segGrad.addColorStop(1, '#243342');
        ctx.fillStyle = segGrad;
        ctx.beginPath();
        ctx.roundRect(cx - bw * 0.5, ry - bh * 0.5, bw, bh, 2);
        ctx.fill();

        // Top-left metallic specular glint on each cast segment
        ctx.strokeStyle = 'rgba(186, 208, 232, 0.45)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx - bw * 0.4, ry + bh * 0.3);
        ctx.lineTo(cx - bw * 0.4, ry - bh * 0.4);
        ctx.lineTo(cx + bw * 0.3, ry - bh * 0.4);
        ctx.stroke();
      }
    }

    // Bottom cast-iron filler plug
    ctx.fillStyle = '#233140';
    ctx.strokeStyle = '#121a24';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-6, 32, 12, 4);
    ctx.strokeRect(-6, 32, 12, 4);

    // Top threaded zinc/steel neck collar
    const neckGrad = ctx.createLinearGradient(-9, -30, 9, -22);
    neckGrad.addColorStop(0, '#94a3b8');
    neckGrad.addColorStop(0.5, '#64748b');
    neckGrad.addColorStop(1, '#334155');
    ctx.fillStyle = neckGrad;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(-8.5, -31, 17, 9, 2);
    ctx.fill();
    ctx.stroke();

    // Fuse striker head & dull brass primer cap
    ctx.fillStyle = '#85754e';
    ctx.strokeStyle = '#27272a';
    ctx.beginPath();
    ctx.roundRect(-10, -38, 20, 7, 2);
    ctx.fill();
    ctx.stroke();

    // Curved steel safety spoon (lever) kicking outward down the side of the grenade
    ctx.save();
    ctx.translate(9, -35);
    ctx.rotate(0.18 + Math.min(0.45, anim.elapsed * 0.6));
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(7, 2);
    ctx.lineTo(11, 34);
    ctx.lineTo(5, 36);
    ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Pulled metallic safety pin ring dangling/spinning near the fuse
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(-14, -32, 6.5, 0, Math.PI * 2);
    ctx.stroke();

    // Fuse ignition sparks & smoke puff
    const sparkRadius = 5 + Math.sin(anim.elapsed * 45) * 2.5;
    const sparkGrad = ctx.createRadialGradient(0, -41, 1, 0, -41, sparkRadius * 2.2);
    sparkGrad.addColorStop(0, '#ffffff');
    sparkGrad.addColorStop(0.4, '#fbbf24');
    sparkGrad.addColorStop(0.8, '#ea580c');
    sparkGrad.addColorStop(1, 'rgba(234, 88, 12, 0)');
    ctx.fillStyle = sparkGrad;
    ctx.beginPath();
    ctx.arc(0, -41, sparkRadius * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    return;
  }

  // Impact shockwave ring
  if (anim.phase === 'impact') {
    const impactElapsed = anim.elapsed - 0.65;
    const radius = 24 + impactElapsed * 320;
    ctx.save();
    ctx.strokeStyle =
      anim.slopPalette === 'brown_blue'
        ? `rgba(92, 126, 162, ${Math.max(0, 0.9 - impactElapsed * 2.5)})`
        : `rgba(158, 72, 52, ${Math.max(0, 0.9 - impactElapsed * 2.5)})`;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(anim.impactX, anim.impactY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPoopSlopSplat(ctx, anim, fadeOut, true);
}

/**
 * Renders thick, lumpy, poop-like dripping sludge along the left or right monitor bezel:
 * - `'brown_red'` for incoming slop received on the Left side
 * - `'brown_blue'` for outgoing slop thrown by the user on the Right side
 */
function drawPoopSlopSplat(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number,
  isGrenade: boolean
): void {
  const inward = anim.side === 'left' ? 1 : -1;
  const edgeX = anim.side === 'left' ? 0 : ctx.canvas.width;
  const isBrownBlue = anim.slopPalette === 'brown_blue';

  ctx.save();
  ctx.globalAlpha = fadeOut;

  // 1. Thick smeared sludge crust along the monitor edge
  const smearGrad = ctx.createLinearGradient(
    edgeX,
    anim.impactY - 55,
    edgeX + inward * 74,
    anim.currentY + 135
  );
  if (isBrownBlue) {
    // Outgoing (Sent by You): Brown-Blue poop-sludge
    smearGrad.addColorStop(0, 'rgba(58, 48, 38, 0.88)');
    smearGrad.addColorStop(0.45, 'rgba(42, 62, 84, 0.86)');
    smearGrad.addColorStop(0.8, 'rgba(66, 54, 42, 0.78)');
    smearGrad.addColorStop(1, 'rgba(30, 38, 48, 0.45)');
  } else {
    // Incoming (Received by You): Brown-Red poop-sludge
    smearGrad.addColorStop(0, 'rgba(88, 32, 20, 0.88)');
    smearGrad.addColorStop(0.45, 'rgba(116, 44, 28, 0.86)');
    smearGrad.addColorStop(0.8, 'rgba(72, 26, 16, 0.78)');
    smearGrad.addColorStop(1, 'rgba(46, 14, 8, 0.45)');
  }

  ctx.fillStyle = smearGrad;
  const crustWidth = isGrenade ? 60 : 38;
  ctx.beginPath();
  if (anim.side === 'left') {
    ctx.roundRect(0, anim.impactY - 50, crustWidth, anim.slideDistance + 125, 26);
  } else {
    ctx.roundRect(edgeX - crustWidth, anim.impactY - 50, crustWidth, anim.slideDistance + 125, 26);
  }
  ctx.fill();

  // 2. Heavy, viscous hanging poop-slop tendrils dripping down the side of the screen
  for (const drip of anim.drips) {
    const wobbleAmp = anim.phase === 'accumulated' ? 0.8 : 3.2;
    const wobbleX =
      anim.impactX +
      drip.offsetX +
      Math.sin(anim.elapsed * drip.wobbleFreq + drip.wobblePhase) * wobbleAmp;
    const topY = drip.originY + anim.slideDistance * 0.42;
    const bottomY = Math.max(topY + 12, drip.currentY);

    // Dark crust shadow behind tendril
    ctx.strokeStyle = isBrownBlue ? 'rgba(20, 24, 30, 0.85)' : 'rgba(36, 10, 6, 0.85)';
    ctx.lineWidth = Math.max(6, drip.radius * 1.18);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wobbleX, topY);
    ctx.lineTo(wobbleX, bottomY);
    ctx.stroke();

    // Main thick sludge tendril
    ctx.strokeStyle = drip.color;
    ctx.lineWidth = Math.max(4.5, drip.radius * 0.96);
    ctx.beginPath();
    ctx.moveTo(wobbleX, topY);
    ctx.lineTo(wobbleX, bottomY);
    ctx.stroke();

    // Bulging, heavy poop-teardrop glob at the bottom of the drip
    ctx.fillStyle = drip.color;
    ctx.strokeStyle = isBrownBlue ? '#1b222c' : '#2b0d08';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(wobbleX, bottomY, drip.radius * 0.98, drip.radius * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Marbled secondary streak inside the drip head
    ctx.fillStyle = isBrownBlue ? 'rgba(46, 74, 102, 0.72)' : 'rgba(132, 52, 34, 0.72)';
    ctx.beginPath();
    ctx.ellipse(
      wobbleX + drip.radius * 0.15,
      bottomY + drip.radius * 0.1,
      drip.radius * 0.48,
      drip.radius * 0.72,
      0.2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Wet specular highlight on the drip glob
    ctx.fillStyle = drip.highlightColor;
    ctx.beginPath();
    ctx.ellipse(
      wobbleX - drip.radius * 0.28,
      bottomY - drip.radius * 0.3,
      drip.radius * 0.26,
      drip.radius * 0.42,
      -0.25,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  // 3. Lumpy, coiled, organic poop-like sludge mounds caked onto the side of the monitor
  for (const blob of anim.blobs) {
    const squishAmp = anim.phase === 'accumulated' ? 0.04 : 0.19;
    const squish = Math.sin(anim.elapsed * blob.squishFreq + blob.squishPhase);
    const rx = blob.baseRadius * (1.06 + squish * squishAmp);
    const ry = blob.baseRadius * (1.22 - squish * squishAmp);
    const bx = anim.impactX + blob.offsetX;
    const slideOffset = Math.min(anim.slideDistance * 0.92, (anim.elapsed - 0.5) * blob.slideRate);
    const by = anim.impactY + blob.offsetY + Math.max(0, slideOffset);

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(blob.lumpAngle);

    const grad = ctx.createRadialGradient(
      -rx * 0.24,
      -ry * 0.24,
      2,
      0,
      0,
      Math.max(rx, ry) * 1.08
    );
    grad.addColorStop(0, blob.secondaryColor);
    grad.addColorStop(0.58, blob.primaryColor);
    grad.addColorStop(1, blob.shadowColor);

    // Lumpy organic poop-mound contour
    ctx.fillStyle = grad;
    ctx.strokeStyle = blob.shadowColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Coiled ridge crease across the mound for realistic poop-sludge texture
    ctx.strokeStyle = isBrownBlue ? 'rgba(20, 28, 38, 0.78)' : 'rgba(38, 10, 6, 0.78)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, ry * 0.12, rx * 0.68, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // Glossy wet sludge highlight
    ctx.fillStyle = isBrownBlue
      ? 'rgba(186, 212, 238, 0.38)'
      : 'rgba(248, 202, 190, 0.38)';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.28, -ry * 0.3, rx * 0.32, ry * 0.18, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // 4. Sludge gas bubbles
  for (const b of anim.bubbles) {
    if (anim.elapsed > b.popTime) continue;
    const bx = anim.impactX + b.offsetX;
    const by = anim.impactY + b.offsetY + anim.slideDistance * 0.82;
    ctx.fillStyle = isBrownBlue ? 'rgba(54, 78, 104, 0.55)' : 'rgba(124, 46, 30, 0.55)';
    ctx.strokeStyle = isBrownBlue ? 'rgba(165, 196, 228, 0.65)' : 'rgba(235, 178, 162, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(bx, by, b.radius + Math.sin(anim.elapsed * 7) * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 5. Show floating callout badge during active impact/drip (first 6.5s) so accumulated crust stays clean
  if (anim.elapsed < 6.5) {
    const labelX = anim.side === 'left' ? 96 : ctx.canvas.width - 324;
    const labelY = Math.min(ctx.canvas.height - 96, Math.max(52, anim.currentY - 20));

    ctx.fillStyle = isBrownBlue ? 'rgba(23, 31, 42, 0.94)' : 'rgba(46, 18, 12, 0.94)';
    ctx.strokeStyle = isBrownBlue ? '#60a5fa' : '#f87171';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, 228, 56, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isBrownBlue ? '#93c5fd' : '#fca5a5';
    ctx.font = 'bold 12px system-ui, sans-serif';
    const titleText = isGrenade
      ? isBrownBlue
        ? `💣 SENT GRENADE (${anim.score}/100)`
        : `💣 RECEIVED GRENADE (${anim.score}/100)`
      : isBrownBlue
        ? `💩 SENT SLOP (${anim.score}/100)`
        : `💩 RECEIVED SLOP (${anim.score}/100)`;
    ctx.fillText(titleText, labelX + 12, labelY + 21);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px system-ui, sans-serif';
    const paletteDesc = isBrownBlue ? 'Brown-Blue Outgoing Slop' : 'Brown-Red Incoming Slop';
    ctx.fillText(paletteDesc, labelX + 12, labelY + 41);
  }

  ctx.restore();
}

/**
 * Renders the animated window squeegee sweeping vertically down the Left or Right
 * monitor edge to scrape off accumulated poop-slop.
 */
function drawSqueegeeWipe(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  wipe: SqueegeeWipe
): void {
  const isLeft = wipe.side === 'left';
  const bladeWidth = 135;
  const bladeX = isLeft ? 0 : viewportWidth - bladeWidth;
  const y = wipe.currentY;

  ctx.save();

  // Clean sparkling glass trail above the squeegee blade
  const cleanGrad = ctx.createLinearGradient(0, Math.max(0, y - 160), 0, y);
  cleanGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
  cleanGrad.addColorStop(1, 'rgba(186, 230, 253, 0.28)');
  ctx.fillStyle = cleanGrad;
  ctx.fillRect(bladeX, Math.max(0, y - 160), bladeWidth, 160);

  // Rubber squeegee blade (cyan-blue silicone lip + brushed aluminum channel)
  ctx.fillStyle = '#0284c7';
  ctx.strokeStyle = '#e0f2fe';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bladeX, y - 6, bladeWidth, 12, 4);
  ctx.fill();
  ctx.stroke();

  // Brushed stainless steel holder bar
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(bladeX + (isLeft ? 0 : 18), y - 14, bladeWidth - 18, 8);

  // Angled ergonomic squeegee handle
  const handleCenterX = isLeft ? bladeWidth * 0.55 : viewportWidth - bladeWidth * 0.55;
  ctx.fillStyle = '#334155';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(handleCenterX - 9, y - 54, 18, 42, 6);
  ctx.fill();
  ctx.stroke();

  // Soapy water foam beads along the scraping edge
  ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
  for (let i = 0; i < 8; i++) {
    const bx = bladeX + 10 + i * 16;
    const by = y + 6 + Math.sin(y * 0.08 + i) * 3;
    ctx.beginPath();
    ctx.arc(bx, by, 3.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Renders 20 distinct, realistic, artistic botanical fruit varieties with multi-stop
 * shading, surface seeds/scales/veins, stems, leaves, and matching juice droplets.
 */
function drawArtisticFruit(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number
): void {
  ctx.save();
  ctx.globalAlpha = fadeOut;

  const juiceColor = getFruitJuiceColor(anim.fruitKind);
  for (const sp of anim.sparkles) {
    ctx.fillStyle = juiceColor;
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y, sp.size * 0.9, sp.size * 1.25, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(anim.currentX, anim.currentY);
  const squish = 1 + Math.sin(anim.elapsed * 8.0) * 0.06;
  ctx.scale(squish * 1.55, (2 - squish) * 1.55);

  drawFruitVarietyArtwork(ctx, anim.fruitKind);
  ctx.restore();

  // Subtle botanical name tag below the bouncing fruit
  const label = FRUIT_LABELS[anim.fruitKind] ?? 'Fresh Fruit';
  const tagX = anim.currentX - 68;
  const tagY = anim.currentY + 42;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.strokeStyle = juiceColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, 136, 26, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(label, tagX + 10, tagY + 17);

  ctx.restore();
}

function getFruitJuiceColor(kind: FruitKind): string {
  switch (kind) {
    case 'honeycrisp_apple':
    case 'ruby_strawberry':
    case 'bing_cherries':
    case 'crimson_watermelon':
    case 'ruby_pomegranate':
      return '#fb7185';
    case 'bartlett_pear':
    case 'emerald_kiwi':
    case 'starfruit_carambola':
      return '#a3e635';
    case 'valencia_orange':
    case 'alphonso_mango':
    case 'sun_peach':
    case 'tropical_papaya':
      return '#fb923c';
    case 'amalfi_lemon':
    case 'golden_pineapple':
      return '#facc15';
    case 'red_dragonfruit':
      return '#f43f5e';
    case 'concord_grapes':
    case 'royal_plum':
    case 'black_mission_fig':
    case 'passionfruit_maracuja':
      return '#c084fc';
    case 'blueberries_cluster':
      return '#60a5fa';
  }
}

function drawStemAndLeaf(ctx: CanvasRenderingContext2D, stemY: number, leafColor = '#22c55e'): void {
  // Woody stem
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, stemY + 4);
  ctx.quadraticCurveTo(2, stemY - 6, 5, stemY - 11);
  ctx.stroke();

  // Botanical veined leaf
  ctx.save();
  ctx.translate(3, stemY - 4);
  ctx.rotate(-0.35);
  const leafGrad = ctx.createLinearGradient(-2, -6, 18, 6);
  leafGrad.addColorStop(0, '#4ade80');
  leafGrad.addColorStop(1, leafColor);
  ctx.fillStyle = leafGrad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(10, -9, 20, -2);
  ctx.quadraticCurveTo(10, 7, 0, 0);
  ctx.fill();

  ctx.strokeStyle = '#14532d';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(17, -1.5);
  ctx.stroke();
  ctx.restore();
}

function drawSpecularHighlight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawFruitVarietyArtwork(ctx: CanvasRenderingContext2D, kind: FruitKind): void {
  switch (kind) {
    case 'honeycrisp_apple': {
      const g = ctx.createRadialGradient(-8, -8, 4, 0, 2, 28);
      g.addColorStop(0, '#fde047');
      g.addColorStop(0.35, '#ef4444');
      g.addColorStop(0.85, '#991b1b');
      g.addColorStop(1, '#450a0a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -19);
      ctx.bezierCurveTo(-22, -26, -28, 8, -11, 23);
      ctx.quadraticCurveTo(0, 27, 0, 21);
      ctx.quadraticCurveTo(0, 27, 11, 23);
      ctx.bezierCurveTo(28, 8, 22, -26, 0, -19);
      ctx.fill();
      drawStemAndLeaf(ctx, -19);
      drawSpecularHighlight(ctx, -9, -7, 8);
      break;
    }

    case 'bartlett_pear': {
      const g = ctx.createRadialGradient(-6, 4, 4, 0, 4, 28);
      g.addColorStop(0, '#fef08a');
      g.addColorStop(0.55, '#a3e635');
      g.addColorStop(0.9, '#65a30d');
      g.addColorStop(1, '#3f6212');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -25);
      ctx.bezierCurveTo(-9, -24, -12, -12, -16, -2);
      ctx.bezierCurveTo(-24, 14, -14, 26, 0, 26);
      ctx.bezierCurveTo(14, 26, 24, 14, 16, -2);
      ctx.bezierCurveTo(12, -12, 9, -24, 0, -25);
      ctx.fill();
      // Warm coral blush on cheek
      drawSpecularHighlight(ctx, -7, 6, 9);
      drawStemAndLeaf(ctx, -25);
      break;
    }

    case 'valencia_orange': {
      const g = ctx.createRadialGradient(-8, -8, 3, 0, 0, 26);
      g.addColorStop(0, '#fde047');
      g.addColorStop(0.45, '#fb923c');
      g.addColorStop(0.88, '#ea580c');
      g.addColorStop(1, '#9a3412');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fill();
      // Citrus dimple pores
      ctx.fillStyle = 'rgba(154, 52, 18, 0.35)';
      for (let i = 0; i < 14; i++) {
        const a = i * 1.9;
        const r = 6 + (i % 3) * 5;
        ctx.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1.5, 1.5);
      }
      drawStemAndLeaf(ctx, -23, '#15803d');
      drawSpecularHighlight(ctx, -8, -8, 8);
      break;
    }

    case 'amalfi_lemon': {
      const g = ctx.createRadialGradient(-7, -6, 3, 0, 0, 28);
      g.addColorStop(0, '#fef9c3');
      g.addColorStop(0.55, '#facc15');
      g.addColorStop(1, '#ca8a04');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.bezierCurveTo(-20, -18, 20, -18, 26, 0);
      ctx.bezierCurveTo(20, 18, -20, 18, -26, 0);
      ctx.fill();
      drawStemAndLeaf(ctx, -15);
      drawSpecularHighlight(ctx, -8, -5, 7);
      break;
    }

    case 'ruby_strawberry': {
      const g = ctx.createRadialGradient(-6, -6, 3, 0, 2, 26);
      g.addColorStop(0, '#fda4af');
      g.addColorStop(0.45, '#e11d48');
      g.addColorStop(1, '#881337');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.bezierCurveTo(-22, -18, -20, 8, 0, 25);
      ctx.bezierCurveTo(20, 8, 22, -18, 0, -18);
      ctx.fill();
      // Golden strawberry seeds (achenes)
      ctx.fillStyle = '#fde68a';
      const seeds: Array<[number, number]> = [
        [-8, -6], [0, -5], [8, -6],
        [-10, 2], [-3, 3], [4, 3], [10, 2],
        [-6, 11], [0, 12], [6, 11], [0, 19]
      ];
      for (const [sx, sy] of seeds) {
        ctx.beginPath();
        ctx.ellipse(sx, sy, 1.1, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Leafy green calyx crown
      ctx.fillStyle = '#22c55e';
      for (const angle of [-0.9, -0.45, 0, 0.45, 0.9]) {
        ctx.save();
        ctx.translate(0, -17);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(0, -3, 3.5, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      drawSpecularHighlight(ctx, -7, -6, 6);
      break;
    }

    case 'bing_cherries': {
      // Twin arched green stems
      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-11, 8);
      ctx.quadraticCurveTo(-8, -16, 2, -24);
      ctx.quadraticCurveTo(10, -14, 12, 10);
      ctx.stroke();
      drawStemAndLeaf(ctx, -21);
      for (const [cx, cy] of [[-11, 11], [11, 13]] as const) {
        const g = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 14);
        g.addColorStop(0, '#f43f5e');
        g.addColorStop(0.55, '#9f1239');
        g.addColorStop(1, '#4c0519');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 12.5, 0, Math.PI * 2);
        ctx.fill();
        drawSpecularHighlight(ctx, cx - 4, cy - 4, 4.5);
      }
      break;
    }

    case 'crimson_watermelon': {
      // Dark green outer rind
      ctx.fillStyle = '#14532d';
      ctx.beginPath();
      ctx.arc(0, -4, 26, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.closePath();
      ctx.fill();
      // Pale green pith
      ctx.fillStyle = '#dcfce7';
      ctx.beginPath();
      ctx.arc(0, -4, 22.5, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.closePath();
      ctx.fill();
      // Crisp crimson flesh
      const g = ctx.createLinearGradient(0, -4, 0, 20);
      g.addColorStop(0, '#fb7185');
      g.addColorStop(1, '#be123c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -4, 19.5, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.closePath();
      ctx.fill();
      // Black teardrop seeds
      ctx.fillStyle = '#1e293b';
      for (const [sx, sy] of [[-9, 5], [-3, 10], [3, 10], [9, 5], [0, 4]] as const) {
        ctx.beginPath();
        ctx.ellipse(sx, sy, 1.3, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'golden_pineapple': {
      // Spiky frond crown
      ctx.fillStyle = '#15803d';
      for (const a of [-0.55, -0.28, 0, 0.28, 0.55]) {
        ctx.save();
        ctx.translate(0, -16);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(0, -18);
        ctx.lineTo(4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // Golden body
      const g = ctx.createRadialGradient(-6, 0, 4, 0, 4, 24);
      g.addColorStop(0, '#fef08a');
      g.addColorStop(0.55, '#eab308');
      g.addColorStop(1, '#a16207');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 6, 17, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      // Diamond cross-hatch scales
      ctx.strokeStyle = 'rgba(120, 53, 15, 0.55)';
      ctx.lineWidth = 1.2;
      for (const d of [-10, -2, 6, 14]) {
        ctx.beginPath();
        ctx.moveTo(-13, d - 6);
        ctx.lineTo(13, d + 8);
        ctx.moveTo(13, d - 6);
        ctx.lineTo(-13, d + 8);
        ctx.stroke();
      }
      break;
    }

    case 'alphonso_mango': {
      ctx.save();
      ctx.rotate(-0.25);
      const g = ctx.createLinearGradient(-16, -22, 16, 24);
      g.addColorStop(0, '#ef4444');
      g.addColorStop(0.48, '#fb923c');
      g.addColorStop(0.82, '#facc15');
      g.addColorStop(1, '#84cc16');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -23);
      ctx.bezierCurveTo(22, -20, 22, 14, 4, 25);
      ctx.bezierCurveTo(-8, 28, -20, 12, -17, -6);
      ctx.bezierCurveTo(-15, -18, -8, -23, 0, -23);
      ctx.fill();
      drawSpecularHighlight(ctx, -5, -6, 8);
      ctx.restore();
      drawStemAndLeaf(ctx, -22);
      break;
    }

    case 'emerald_kiwi': {
      // Fuzzy brown outer skin
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, Math.PI * 2);
      ctx.fill();
      // Glowing emerald flesh
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 20);
      g.addColorStop(0, '#ecfccb');
      g.addColorStop(0.35, '#84cc16');
      g.addColorStop(1, '#3f6212');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 19.5, 0, Math.PI * 2);
      ctx.fill();
      // Pale core & radiating spokes
      ctx.fillStyle = '#f7fee7';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ring of tiny black kiwi seeds
      ctx.fillStyle = '#1e293b';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 10.5, Math.sin(a) * 11.5, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'red_dragonfruit': {
      const g = ctx.createRadialGradient(-5, -5, 3, 0, 2, 25);
      g.addColorStop(0, '#fb7185');
      g.addColorStop(0.6, '#e11d48');
      g.addColorStop(1, '#881337');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 2, 19, 23, 0, 0, Math.PI * 2);
      ctx.fill();
      // Lime-tipped dragon scales
      ctx.fillStyle = '#84cc16';
      for (const [sx, sy, rot] of [
        [-16, -8, -0.6],
        [16, -8, 0.6],
        [-18, 6, -0.8],
        [18, 6, 0.8],
        [0, -22, 0]
      ] as const) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.moveTo(-4, 4);
        ctx.quadraticCurveTo(0, -9, 4, 4);
        ctx.fill();
        ctx.restore();
      }
      drawSpecularHighlight(ctx, -6, -4, 7);
      break;
    }

    case 'concord_grapes': {
      drawStemAndLeaf(ctx, -22);
      const grapes: Array<[number, number]> = [
        [-10, -10], [0, -11], [10, -10],
        [-13, -1], [-4, -1], [5, -1], [13, -1],
        [-8, 8], [1, 8], [9, 8],
        [-4, 16], [4, 16],
        [0, 23]
      ];
      for (const [gx, gy] of grapes) {
        const g = ctx.createRadialGradient(gx - 2, gy - 2, 1, gx, gy, 8);
        g.addColorStop(0, '#c084fc');
        g.addColorStop(0.55, '#6b21a8');
        g.addColorStop(1, '#3b0764');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, 7.2, 0, Math.PI * 2);
        ctx.fill();
        drawSpecularHighlight(ctx, gx - 2, gy - 2, 2.5);
      }
      break;
    }

    case 'sun_peach': {
      const g = ctx.createRadialGradient(-7, -6, 3, 0, 2, 26);
      g.addColorStop(0, '#fef08a');
      g.addColorStop(0.45, '#fb923c');
      g.addColorStop(0.85, '#e11d48');
      g.addColorStop(1, '#9f1239');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(-6, 2, 17, 0, Math.PI * 2);
      ctx.arc(6, 2, 17, 0, Math.PI * 2);
      ctx.fill();
      drawStemAndLeaf(ctx, -16);
      drawSpecularHighlight(ctx, -9, -5, 7);
      break;
    }

    case 'royal_plum': {
      const g = ctx.createRadialGradient(-7, -7, 3, 0, 0, 25);
      g.addColorStop(0, '#e9d5ff');
      g.addColorStop(0.35, '#9333ea');
      g.addColorStop(0.8, '#4c1d95');
      g.addColorStop(1, '#2e1065');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 2, 20, 23, 0, 0, Math.PI * 2);
      ctx.fill();
      drawStemAndLeaf(ctx, -20);
      drawSpecularHighlight(ctx, -7, -6, 8);
      break;
    }

    case 'ruby_pomegranate': {
      // Regal crown calyx at top
      ctx.fillStyle = '#991b1b';
      ctx.beginPath();
      ctx.moveTo(-9, -18);
      ctx.lineTo(-6, -27);
      ctx.lineTo(-2, -21);
      ctx.lineTo(2, -28);
      ctx.lineTo(6, -21);
      ctx.lineTo(9, -26);
      ctx.lineTo(10, -18);
      ctx.closePath();
      ctx.fill();

      const g = ctx.createRadialGradient(-7, -5, 3, 0, 3, 25);
      g.addColorStop(0, '#fb7185');
      g.addColorStop(0.55, '#b91c1c');
      g.addColorStop(1, '#450a0a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 3, 22, 0, Math.PI * 2);
      ctx.fill();
      drawSpecularHighlight(ctx, -8, -4, 7);
      break;
    }

    case 'black_mission_fig': {
      const g = ctx.createRadialGradient(-5, 4, 3, 0, 4, 25);
      g.addColorStop(0, '#a855f7');
      g.addColorStop(0.5, '#581c87');
      g.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -23);
      ctx.bezierCurveTo(-6, -20, -22, 2, -16, 18);
      ctx.bezierCurveTo(-10, 26, 10, 26, 16, 18);
      ctx.bezierCurveTo(22, 2, 6, -20, 0, -23);
      ctx.fill();
      drawSpecularHighlight(ctx, -6, 5, 7);
      break;
    }

    case 'tropical_papaya': {
      const g = ctx.createRadialGradient(0, 2, 4, 0, 2, 25);
      g.addColorStop(0, '#fb7185');
      g.addColorStop(0.65, '#f97316');
      g.addColorStop(0.9, '#facc15');
      g.addColorStop(1, '#15803d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 2, 18, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      // Dark papaya caviar seeds in center cavity
      ctx.fillStyle = '#1c1917';
      for (const [sx, sy] of [[-3, -2], [3, -2], [-4, 3], [0, 4], [4, 3], [-2, 8], [2, 8]] as const) {
        ctx.beginPath();
        ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'starfruit_carambola': {
      const g = ctx.createRadialGradient(0, 0, 3, 0, 0, 25);
      g.addColorStop(0, '#fef9c3');
      g.addColorStop(0.65, '#facc15');
      g.addColorStop(1, '#65a30d');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 25 : 10;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'blueberries_cluster': {
      drawStemAndLeaf(ctx, -18);
      for (const [bx, by, br] of [[-10, 5, 12], [10, 6, 11.5], [0, -5, 12.5]] as const) {
        const g = ctx.createRadialGradient(bx - 3, by - 3, 2, bx, by, br);
        g.addColorStop(0, '#93c5fd');
        g.addColorStop(0.5, '#1d4ed8');
        g.addColorStop(1, '#172554');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
        drawSpecularHighlight(ctx, bx - 3, by - 3, 4);
      }
      break;
    }

    case 'passionfruit_maracuja': {
      const g = ctx.createRadialGradient(-6, -6, 3, 0, 0, 24);
      g.addColorStop(0, '#a855f7');
      g.addColorStop(0.55, '#581c87');
      g.addColorStop(1, '#2e1065');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      // Golden aromatic interior pulp ring
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(4, 4, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c1917';
      for (const [sx, sy] of [[2, 2], [6, 3], [3, 7], [7, 7]] as const) {
        ctx.beginPath();
        ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      drawSpecularHighlight(ctx, -7, -7, 7);
      break;
    }
  }
}

function drawPeacefulCloud(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number
): void {
  ctx.save();
  ctx.globalAlpha = fadeOut * 0.86;
  ctx.translate(anim.currentX, anim.currentY);

  const grad = ctx.createLinearGradient(0, -24, 0, 20);
  grad.addColorStop(0, 'rgba(224, 242, 254, 0.95)');
  grad.addColorStop(1, 'rgba(186, 230, 253, 0.78)');
  ctx.fillStyle = grad;

  const puffs: Array<[number, number, number]> = [
    [-22, 4, 15],
    [-6, -6, 20],
    [14, -2, 17],
    [26, 6, 13],
    [2, 8, 16]
  ];
  for (const [px, py, r] of puffs) {
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHumanSparkles(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number
): void {
  ctx.save();
  for (const sp of anim.sparkles) {
    const twinkle = 0.65 + 0.35 * Math.sin(anim.elapsed * 6 + sp.twinklePhase);
    const alpha = sp.alpha * twinkle * fadeOut;
    ctx.fillStyle = `rgba(253, 230, 138, ${alpha.toFixed(3)})`;

    // Delicate 4-point sparkle plume
    ctx.beginPath();
    const s = sp.size;
    ctx.moveTo(sp.x, sp.y - s * 2.1);
    ctx.quadraticCurveTo(sp.x, sp.y, sp.x + s * 2.1, sp.y);
    ctx.quadraticCurveTo(sp.x, sp.y, sp.x, sp.y + s * 2.1);
    ctx.quadraticCurveTo(sp.x, sp.y, sp.x - s * 2.1, sp.y);
    ctx.quadraticCurveTo(sp.x, sp.y, sp.x, sp.y - s * 2.1);
    ctx.fill();
  }
  ctx.restore();
}
