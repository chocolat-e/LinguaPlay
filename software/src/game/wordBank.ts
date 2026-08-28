import { WORD_CONNECT_MAX_LETTERS, WORD_CONNECT_MIN_LETTERS } from './constants';
import type { Question } from './types';

/**
 * Last-resort puzzle words, used only when the live question pool yields
 * nothing short enough. Every one is within the letter limit, so a special
 * attack can never be earned and then handed an unbuildable puzzle.
 */
const FALLBACK_WORDS = [
  'CAT', 'BOOK', 'TREE', 'GAME', 'FAST', 'BLUE', 'FISH', 'JUMP', 'RAIN', 'STAR',
  'WIND', 'GOLD', 'MILK', 'ROAD', 'SNOW', 'BIRD', 'DOOR', 'HAND', 'LAKE', 'SONG',
];

/** Fisher–Yates, on a copy. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Every single word of an eligible length appearing in these strings. */
export function collectWords(sources: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    for (const token of source.split(/[^A-Za-z]+/)) {
      if (token.length < WORD_CONNECT_MIN_LETTERS) continue;
      if (token.length > WORD_CONNECT_MAX_LETTERS) continue;
      found.add(token.toUpperCase());
    }
  }
  return [...found];
}

/**
 * Words for one special attack.
 *
 * Prefers vocabulary the player has just been answering with, falls back to the
 * rest of the question pool, then to the fixed list — so reaching the streak
 * always produces a valid puzzle, even when the last few questions happened to
 * contain nothing short enough.
 */
export function pickWordConnectWords(
  recent: Iterable<string>,
  pool: readonly Question[],
  count: number,
): string[] {
  const preferred = shuffle(collectWords(recent));
  const fromPool = shuffle(
    collectWords(pool.flatMap((question) => [question.question, ...question.answers])),
  );
  const fallback = shuffle(FALLBACK_WORDS);

  const chosen: string[] = [];
  for (const word of [...preferred, ...fromPool, ...fallback]) {
    if (chosen.length >= count) break;
    if (!chosen.includes(word)) chosen.push(word);
  }
  return chosen;
}
