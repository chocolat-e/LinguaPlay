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

const PICTURE_SIZE = 512;
/**
 * Pictures get their own cache rather than sharing the answer cards'. That one
 * evicts its oldest entry once it grows past a cap, and a chase holding a
 * texture that had just been disposed would render a black block.
 * `pictureBank` is a fixed list, so this map has a natural ceiling of its own.
 */
const pictureCache = new Map<string, THREE.CanvasTexture>();
const EMOJI_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif';

/**
 * A picture card for the kart chase: the emoji large, its English word beneath.
 *
 * Emoji rather than image files, for the same reason the sounds are synthesised
 * — there is no asset to ship, nothing to fetch, and nothing that can 404. The
 * word is drawn on every card, on topic or not, so the picture never gives the
 * answer away by how it is presented; only what it *is* decides the lane.
 */
export function getPictureTexture(
  emoji: string,
  word: string,
  color: string,
): THREE.CanvasTexture {
  const key = `${emoji}|${word}|${color}`;
  const cached = pictureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_SIZE;
  canvas.height = PICTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const pad = 14;
  const inner = PICTURE_SIZE - pad * 2;

  ctx.clearRect(0, 0, PICTURE_SIZE, PICTURE_SIZE);

  // Same dark glassy panel as the answer cards, so the two read as one game.
  roundRect(ctx, pad, pad, inner, inner, 46);
  const body = ctx.createLinearGradient(0, pad, 0, PICTURE_SIZE - pad);
  body.addColorStop(0, 'rgba(15, 23, 42, 0.96)');
  body.addColorStop(1, 'rgba(10, 16, 30, 0.98)');
  ctx.fillStyle = body;
  ctx.fill();

  ctx.lineWidth = 11;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // The picture. Colour emoji ignore fillStyle, which is the point of them.
  ctx.font = `300px ${EMOJI_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, PICTURE_SIZE / 2, PICTURE_SIZE * 0.40);

  // A band behind the word, so it stays legible over a busy emoji rather than
  // relying on a drop shadow that the bloom pass washes out anyway.
  const bandY = PICTURE_SIZE * 0.755;
  const bandH = PICTURE_SIZE * 0.2;
  ctx.fillStyle = 'rgba(4, 9, 20, 0.9)';
  ctx.fillRect(pad + 6, bandY, inner - 12, bandH);

  // The word, shrunk to fit however long it is.
  let size = 88;
  const maxWidth = inner - 34;
  do {
    ctx.font = `900 ${size}px ${FONT_STACK}`;
    if (ctx.measureText(word).width <= maxWidth) break;
    size -= 4;
  } while (size > 32);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(word, PICTURE_SIZE / 2, bandY + bandH / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  pictureCache.set(key, texture);
  return texture;
}

const SIGN_W = 1024;
const SIGN_H = 232;
const signCache = new Map<string, THREE.CanvasTexture>();

/**
 * A roadside sign carrying the chase's topic.
 *
 * The topic is the whole question of the kart chase, and the player's eyes are
 * on the road, not on the HUD strip at the top of the screen. Repeating it down
 * the tunnel wall — the way a motorway keeps telling you which road you are on
 * — means it can never be lost track of at speed.
 */
export function getTopicSignTexture(topic: string, color: string): THREE.CanvasTexture {
  const key = `${topic}|${color}`;
  const cached = signCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = SIGN_W;
  canvas.height = SIGN_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.clearRect(0, 0, SIGN_W, SIGN_H);

  // Dark plate, so the word holds up against a bright tunnel wall.
  roundRect(ctx, 8, 8, SIGN_W - 16, SIGN_H - 16, 26);
  ctx.fillStyle = 'rgba(6, 12, 26, 0.9)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Chevrons pointing the way down the road, on both ends.
  ctx.strokeStyle = color;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    for (const [x, dir] of [[54 + i * 26, 1], [SIGN_W - 54 - i * 26, -1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x - 11 * dir, SIGN_H / 2 - 26);
      ctx.lineTo(x + 11 * dir, SIGN_H / 2);
      ctx.lineTo(x - 11 * dir, SIGN_H / 2 + 26);
      ctx.globalAlpha = 0.35 + i * 0.25;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // The topic itself, shrunk only as far as it has to be to fit.
  const maxWidth = SIGN_W - 320;
  let size = 108;
  do {
    ctx.font = `900 ${size}px ${FONT_STACK}`;
    if (ctx.measureText(topic).width <= maxWidth) break;
    size -= 4;
  } while (size > 44);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = color;
  ctx.shadowBlur = 30;
  ctx.fillText(topic, SIGN_W / 2, SIGN_H / 2 + 4);
  ctx.shadowBlur = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  // One entry per topic, and there are only a handful of topics.
  signCache.set(key, texture);
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
