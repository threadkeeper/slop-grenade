/**
 * Brass-handled squeegee that wipes one monitor edge clean.
 * Mirrored in `desktop/Effects/Squeegee.cs`.
 */
import { css } from './math';
import { BRASS, INK, type SlopPalette } from './palette';

export class Squeegee {
  readonly side: 'left' | 'right';
  y: number;
  readonly speed: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly width: number;
  readonly pal: SlopPalette;
  pile = 0;
  done = false;
  age = 0;

  constructor(side: 'left' | 'right', viewW: number, viewH: number, stripW: number, pal: SlopPalette) {
    this.side = side;
    this.viewW = viewW;
    this.viewH = viewH;
    this.width = stripW * 0.92;
    this.pal = pal;
    this.y = -60;
    this.speed = Math.max(620, viewH * 0.85);
  }

  update(dt: number): void {
    this.age += dt;
    this.y += this.speed * dt;
    if (this.y > this.viewH + 140) this.done = true;
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    const left = this.side === 'left';
    const x0 = left ? 0 : this.viewW - this.width;
    const x1 = left ? this.width : this.viewW;
    const y = this.y;
    const wob = Math.sin(this.age * 18) * 0.02;
    ctx.save();
    ctx.translate((x0 + x1) / 2, y);
    ctx.rotate(wob);
    ctx.translate(-(x0 + x1) / 2, -y);
    // clean shine trail
    const g = ctx.createLinearGradient(0, y - 180 * s, 0, y);
    g.addColorStop(0, 'rgba(190,235,255,0)');
    g.addColorStop(1, 'rgba(190,235,255,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - 180 * s, x1 - x0, 180 * s);
    // scraped slop riding the blade
    if (this.pile > 0) {
      const ph = Math.min(46 * s, Math.sqrt(this.pile) * 0.22);
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, y - 12 * s, (x1 - x0) * 0.46, ph, 0, Math.PI, Math.PI * 2);
      ctx.fillStyle = css(this.pal.base);
      ctx.fill();
      ctx.lineWidth = 2.6 * s;
      ctx.strokeStyle = css(INK);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2 - (x1 - x0) * 0.18, y - 12 * s - ph * 0.55, (x1 - x0) * 0.1, ph * 0.18, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = css(this.pal.light);
      ctx.fill();
    }
    // handle
    const hx = left ? x0 + (x1 - x0) * 0.58 : x1 - (x1 - x0) * 0.58;
    ctx.save();
    ctx.translate(hx, y - 16 * s);
    ctx.rotate(left ? 0.32 : -0.32);
    ctx.beginPath();
    ctx.rect(-7 * s, -96 * s, 14 * s, 90 * s);
    ctx.fillStyle = '#7a4a26';
    ctx.fill();
    ctx.lineWidth = 2.8 * s;
    ctx.strokeStyle = css(INK);
    ctx.stroke();
    ctx.fillStyle = '#a8703c';
    ctx.fillRect(-4 * s, -94 * s, 4 * s, 86 * s);
    ctx.beginPath();
    ctx.rect(-9 * s, -20 * s, 18 * s, 14 * s);
    ctx.fillStyle = css(BRASS.base);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // brass channel with rivets
    ctx.beginPath();
    ctx.rect(x0, y - 22 * s, x1 - x0, 14 * s);
    ctx.fillStyle = css(BRASS.base);
    ctx.fill();
    ctx.lineWidth = 2.8 * s;
    ctx.strokeStyle = css(INK);
    ctx.stroke();
    ctx.fillStyle = css(BRASS.light);
    ctx.fillRect(x0 + 3 * s, y - 20 * s, x1 - x0 - 6 * s, 3 * s);
    ctx.fillStyle = css(BRASS.dark);
    for (let rx = x0 + 14 * s; rx < x1 - 8 * s; rx += 36 * s) {
      ctx.beginPath();
      ctx.arc(rx, y - 15 * s, 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // rubber blade
    ctx.beginPath();
    ctx.rect(x0, y - 8 * s, x1 - x0, 10 * s);
    ctx.fillStyle = '#23262e';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x0 + 2 * s, y - 6 * s, x1 - x0 - 4 * s, 2 * s);
    ctx.restore();
  }
}
