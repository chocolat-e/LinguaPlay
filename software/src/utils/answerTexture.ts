import * as THREE from 'three';

const WIDTH = 1024;
const HEIGHT = 464;
const FONT_STACK =
  '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif';

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Renders an answer card face to a canvas texture.
 *
 * Drawing the label into the 3D material (rather than overlaying DOM) keeps the
 * text correctly depth-sorted as targets fly past, and lets it pick up bloom
 * with the rest of the scene. No webfont is fetched, so nothing can 404.
 */
export function getAnswerTexture(
  letter: string,
  text: string,
  color: string,
): THREE.CanvasTexture {
  const key = `${letter}|${text}|${color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  drawCard(ctx, letter, text, color);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  // Cheap guard against unbounded growth across a long session.
  if (cache.size > 80) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.get(oldest)?.dispose();
      cache.delete(oldest);
    }
  }
  cache.set(key, texture);
  return texture;
}

const LETTER_SIZE = 256;

/**
 * A single big letter on a transparent square, for the word-connect slots.
 * Same canvas-into-the-material trick as the answer cards, so the letters pick
 * up bloom and depth-sort with everything else in the scene.
 */
export function getLetterTexture(letter: string, color: string): THREE.CanvasTexture {
  const key = `letter|${letter}|${color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = LETTER_SIZE;
  canvas.height = LETTER_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const half = LETTER_SIZE / 2;
  ctx.clearRect(0, 0, LETTER_SIZE, LETTER_SIZE);
  ctx.font = `900 168px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter.toUpperCase(), half, half + 8);
  ctx.shadowBlur = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  letter: string,
  text: string,
  color: string,
): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  const pad = 22;
  const radius = 44;

  // Body: a dark glassy panel with a vertical sheen.
  const body = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  body.addColorStop(0, 'rgba(15, 23, 42, 0.97)');
  body.addColorStop(0.5, 'rgba(10, 16, 30, 0.97)');
  body.addColorStop(1, 'rgba(13, 20, 37, 0.98)');
  roundRect(ctx, pad, pad, WIDTH - pad * 2, HEIGHT - pad * 2, radius);
  ctx.fillStyle = body;
  ctx.fill();

  // Frame: present, but not a light source.
  ctx.lineWidth = 7;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Letter badge on the left.
  const badge = 132;
  const badgeX = pad + 34;
  const badgeY = (HEIGHT - badge) / 2;
  roundRect(ctx, badgeX, badgeY, badge, badge, 28);
  const badgeFill = ctx.createLinearGradient(badgeX, badgeY, badgeX, badgeY + badge);
  badgeFill.addColorStop(0, color);
  badgeFill.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = badgeFill;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#05070f';
  ctx.font = `900 88px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, badgeX + badge / 2, badgeY + badge / 2 + 5);

  // Answer text, auto-fitted into the remaining space.
  const textLeft = badgeX + badge + 38;
  const textWidth = WIDTH - pad - 30 - textLeft;
  const { lines, fontSize } = fitText(ctx, text, textWidth, HEIGHT - 96, 116, 58);

  ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 8;

  const lineHeight = fontSize * 1.16;
  const blockHeight = lines.length * lineHeight;
  let y = (HEIGHT - blockHeight) / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, textLeft, y);
    y += lineHeight;
  }
  ctx.shadowBlur = 0;
}

/** Shrinks the font until the wrapped text fits the given box. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  startSize: number,
  minSize: number,
): { lines: string[]; fontSize: number } {
  for (let size = startSize; size >= minSize; size -= 5) {
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length * size * 1.16 <= maxHeight && lines.length <= 3) {
      return { lines, fontSize: size };
    }
  }
  ctx.font = `800 ${minSize}px ${FONT_STACK}`;
  return { lines: wrap(ctx, text, maxWidth).slice(0, 3), fontSize: minSize };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, next)));
  });
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}
