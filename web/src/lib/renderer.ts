import type { ActiveAnimation } from './physics';

/**
 * Render all active animations onto the full-viewport monitor overlay canvas.
 */
export function renderAnimations(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  animations: ActiveAnimation[]
): void {
  ctx.clearRect(0, 0, width, height);

  for (const anim of animations) {
    if (anim.phase === 'done') continue;
    const progress = anim.elapsed / anim.duration;
    const fadeOut = progress > 0.78 ? Math.max(0, 1 - (progress - 0.78) / 0.22) : 1;

    ctx.save();
    if (anim.shakeIntensity > 0) {
      const dx = (Math.random() - 0.5) * anim.shakeIntensity;
      const dy = (Math.random() - 0.5) * anim.shakeIntensity;
      ctx.translate(dx, dy);
    }

    if (anim.tier === 'slop_grenade') {
      drawSlopGrenade(ctx, anim, fadeOut);
    } else if (anim.tier === 'slop_splat') {
      drawGoopSplat(ctx, anim, fadeOut, false);
    } else if (anim.tier === 'innocent_fruit') {
      drawInnocentFruit(ctx, anim, fadeOut);
    } else if (anim.tier === 'peaceful_cloud') {
      drawPeacefulCloud(ctx, anim, fadeOut);
    } else {
      drawHumanSparkles(ctx, anim, fadeOut);
    }

    ctx.restore();
  }
}

function drawSlopGrenade(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number
): void {
  if (anim.phase === 'flight') {
    // Draw ballistic spark trail
    ctx.save();
    ctx.strokeStyle = 'rgba(190, 242, 100, 0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(anim.startX, anim.startY);
    ctx.quadraticCurveTo(
      (anim.startX + anim.impactX) * 0.5,
      Math.min(anim.startY, anim.impactY) - 180,
      anim.currentX,
      anim.currentY
    );
    ctx.stroke();
    ctx.restore();

    // Draw tumbling pineapple hand grenade
    ctx.save();
    ctx.translate(anim.currentX, anim.currentY);
    ctx.rotate(anim.rotation);

    // Outer glow
    const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, 42);
    glow.addColorStop(0, 'rgba(163, 230, 53, 0.65)');
    glow.addColorStop(1, 'rgba(163, 230, 53, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.fill();

    // Grenade body
    ctx.fillStyle = '#365314';
    ctx.strokeStyle = '#a3e635';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 4, 20, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pineapple segmentation ridges
    ctx.strokeStyle = '#1a2e05';
    ctx.lineWidth = 1.8;
    for (const ry of [-10, 0, 10, 18]) {
      ctx.beginPath();
      ctx.moveTo(-17, ry);
      ctx.lineTo(17, ry);
      ctx.stroke();
    }
    for (const rx of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.moveTo(rx, -18);
      ctx.lineTo(rx, 26);
      ctx.stroke();
    }

    // Fuse neck & safety lever
    ctx.fillStyle = '#71717a';
    ctx.fillRect(-7, -28, 14, 8);
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(10, -24, 7, 0, Math.PI * 2);
    ctx.stroke();

    // Fuse spark
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, -32, 6 + Math.sin(anim.elapsed * 40) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Impact flash shockwave
  if (anim.phase === 'impact') {
    const impactElapsed = anim.elapsed - 0.62;
    const radius = 24 + impactElapsed * 320;
    ctx.save();
    ctx.strokeStyle = `rgba(190, 242, 100, ${Math.max(0, 0.9 - impactElapsed * 2.5)})`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(anim.impactX, anim.impactY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawGoopSplat(ctx, anim, fadeOut, true);
}

function drawGoopSplat(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number,
  isGrenade: boolean
): void {
  const inward = anim.side === 'left' ? 1 : -1;
  const edgeX = anim.side === 'left' ? 0 : ctx.canvas.width;

  ctx.save();
  ctx.globalAlpha = fadeOut;

  // 1. Translucent slime trail smeared down the side of the monitor
  const trailGrad = ctx.createLinearGradient(
    edgeX,
    anim.impactY - 50,
    edgeX + inward * 68,
    anim.currentY + 120
  );
  if (isGrenade) {
    trailGrad.addColorStop(0, 'rgba(132, 204, 22, 0.42)');
    trailGrad.addColorStop(0.6, 'rgba(163, 230, 53, 0.68)');
    trailGrad.addColorStop(1, 'rgba(77, 124, 15, 0.15)');
  } else {
    trailGrad.addColorStop(0, 'rgba(234, 179, 8, 0.35)');
    trailGrad.addColorStop(1, 'rgba(132, 204, 22, 0.2)');
  }

  ctx.fillStyle = trailGrad;
  ctx.beginPath();
  if (anim.side === 'left') {
    ctx.roundRect(0, anim.impactY - 45, isGrenade ? 54 : 32, anim.slideDistance + 110, 24);
  } else {
    const w = isGrenade ? 54 : 32;
    ctx.roundRect(edgeX - w, anim.impactY - 45, w, anim.slideDistance + 110, 24);
  }
  ctx.fill();

  // 2. Viscous hanging goop drips sliding down the monitor bezel
  for (const drip of anim.drips) {
    const wobbleX =
      anim.impactX +
      drip.offsetX +
      Math.sin(anim.elapsed * drip.wobbleFreq + drip.wobblePhase) * 3.5;
    const topY = drip.originY + anim.slideDistance * 0.45;
    const bottomY = Math.max(topY + 10, drip.currentY);

    // Stretchy slime tendril neck
    ctx.strokeStyle = isGrenade ? 'rgba(132, 204, 22, 0.88)' : 'rgba(202, 138, 4, 0.82)';
    ctx.lineWidth = Math.max(4, drip.radius * 0.95);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wobbleX, topY);
    ctx.lineTo(wobbleX, bottomY);
    ctx.stroke();

    // Swollen teardrop goop head at the bottom of the drip
    ctx.fillStyle = isGrenade ? '#84cc16' : '#eab308';
    ctx.beginPath();
    ctx.ellipse(
      wobbleX,
      bottomY,
      drip.radius * 0.92,
      drip.radius * 1.28,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Glossy wet highlight on each drip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(wobbleX - drip.radius * 0.25, bottomY - drip.radius * 0.25, drip.radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Squishy metaball goop cluster sliding down the side of the monitor
  for (const blob of anim.blobs) {
    const squish = Math.sin(anim.elapsed * blob.squishFreq + blob.squishPhase);
    const rx = blob.baseRadius * (1 + squish * 0.22);
    const ry = blob.baseRadius * (1.18 - squish * 0.18);
    const bx = anim.impactX + blob.offsetX;
    const by = anim.impactY + blob.offsetY + (anim.elapsed - 0.6) * blob.slideRate;

    const grad = ctx.createRadialGradient(bx - rx * 0.2, by - ry * 0.2, 2, bx, by, Math.max(rx, ry));
    grad.addColorStop(0, `hsla(${blob.hue}, 92%, 68%, 0.95)`);
    grad.addColorStop(0.65, `hsla(${blob.hue}, 86%, 46%, 0.92)`);
    grad.addColorStop(1, `hsla(${blob.hue - 10}, 84%, 28%, 0.85)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Specular wet sheen
    ctx.fillStyle = 'rgba(254, 249, 195, 0.42)';
    ctx.beginPath();
    ctx.ellipse(bx - rx * 0.28, by - ry * 0.3, rx * 0.28, ry * 0.18, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Toxic gas bubbles inside the goop
  for (const b of anim.bubbles) {
    if (anim.elapsed > b.popTime) continue;
    const bx = anim.impactX + b.offsetX;
    const by = anim.impactY + b.offsetY + anim.slideDistance * 0.85;
    ctx.strokeStyle = 'rgba(236, 252, 203, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, b.radius + Math.sin(anim.elapsed * 8) * 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 5. Floating HUD callout next to the goop splat
  const labelX = anim.side === 'left' ? 92 : ctx.canvas.width - 310;
  const labelY = Math.min(ctx.canvas.height - 90, Math.max(48, anim.currentY - 18));

  ctx.fillStyle = isGrenade ? 'rgba(20, 38, 6, 0.92)' : 'rgba(42, 34, 7, 0.9)';
  ctx.strokeStyle = isGrenade ? '#a3e635' : '#facc15';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, 218, 54, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = isGrenade ? '#bef264' : '#fde047';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(
    isGrenade ? `💣 SLOP GRENADE (${anim.score}/100)` : `🟢 SLOP SPLAT (${anim.score}/100)`,
    labelX + 12,
    labelY + 21
  );

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px system-ui, sans-serif';
  const senderClip = anim.sender.length > 26 ? `${anim.sender.slice(0, 25)}…` : anim.sender;
  ctx.fillText(senderClip, labelX + 12, labelY + 40);

  ctx.restore();
}

function drawInnocentFruit(
  ctx: CanvasRenderingContext2D,
  anim: ActiveAnimation,
  fadeOut: number
): void {
  ctx.save();
  ctx.globalAlpha = fadeOut;

  // Sparkling juice droplets
  for (const sp of anim.sparkles) {
    ctx.fillStyle = anim.fruitKind === 'lemon' ? '#fde047' : '#fda4af';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(anim.currentX, anim.currentY);
  const squish = 1 + Math.sin(anim.elapsed * 8.4) * 0.08;
  ctx.scale(squish, 2 - squish);

  // Cute fruit body
  if (anim.fruitKind === 'peach') {
    const g = ctx.createRadialGradient(-6, -6, 3, 0, 0, 24);
    g.addColorStop(0, '#fed7aa');
    g.addColorStop(0.6, '#fb923c');
    g.addColorStop(1, '#f43f5e');
    ctx.fillStyle = g;
  } else if (anim.fruitKind === 'lemon') {
    ctx.fillStyle = '#facc15';
  } else {
    ctx.fillStyle = '#fb7185';
  }

  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.fill();

  // Green leaf
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.ellipse(6, -22, 9, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // Glossy cheek highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(-7, -7, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
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
