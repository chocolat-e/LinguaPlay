import {
  SLOT_DIRECTIONS,
  SPECIAL_DAMAGE_BY_WORDS,
  SPECIAL_DAMAGE_EXTRA_WORD,
  WORD_CONNECT_GAP,
  WORD_CONNECT_SECONDS,
} from './constants';
import type { WordConnectSlot, WordConnectSnapshot } from './types';

export type WordPunchResult = 'HIT' | 'WORD' | 'FAIL' | 'IGNORED';

const IDLE_SNAPSHOT: WordConnectSnapshot = {
  active: false,
  word: '',
  progress: 0,
  slots: [],
  wordIndex: 0,
  totalWords: 0,
  wordsCompleted: 0,
  timeRemaining: 0,
  status: 'DONE',
};

/** Fisher–Yates, on a copy. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The earned mini game: a short word is scattered across the four slots around
 * the player, who has to walk to each letter in order and punch it.
 *
 * It is a combat move, not a second quiz — the only thing it produces is the
 * size of the special attack. It reuses the same move-then-punch rule as the
 * answer lanes, just on two axes instead of one.
 */
export class WordConnectManager {
  private words: string[] = [];
  private index = 0;
  private slots: WordConnectSlot[] = [];
  private progress = 0;
  private completed = 0;
  private timeRemaining = 0;
  private gap = 0;
  private state: WordConnectSnapshot['status'] = 'DONE';

  get active(): boolean {
    return this.state !== 'DONE';
  }

  get status(): WordConnectSnapshot['status'] {
    return this.state;
  }

  get wordsCompleted(): number {
    return this.completed;
  }

  get currentWord(): string {
    return this.words[this.index] ?? '';
  }

  /** The live slot list. Read per frame by the scene; never reallocated here. */
  get liveSlots(): readonly WordConnectSlot[] {
    return this.slots;
  }

  start(words: readonly string[]): void {
    this.words = words.slice();
    this.index = 0;
    this.completed = 0;
    this.gap = 0;
    this.beginWord();
  }

  /**
   * Resolve the player choosing `slotIndex` (null means they chose nothing,
   * which fails the word just like a wrong letter does).
   */
  punch(slotIndex: number | null): WordPunchResult {
    if (this.state !== 'PLAYING') return 'IGNORED';
    if (slotIndex === null) return this.failWord();

    const slot = this.slots.find((entry) => entry.index === slotIndex);
    // A letter already connected is not a wrong answer, it is a non-choice —
    // reaching back over it costs nothing.
    if (slot?.usedAt != null) return 'IGNORED';

    const needed = this.currentWord[this.progress];
    // Matching on the letter rather than the slot keeps repeated letters
    // (BOOK) solvable — either O is a legitimate next step.
    if (!slot || slot.letter !== needed) return this.failWord();

    slot.usedAt = this.progress;
    this.progress += 1;
    if (this.progress < this.currentWord.length) return 'HIT';

    this.completed += 1;
    this.state = 'COMPLETE';
    this.gap = WORD_CONNECT_GAP;
    return 'WORD';
  }

  /**
   * Advance timers.
   * @returns 'DONE' once every word is finished and the attack should fire.
   */
  tick(dt: number): 'CONTINUE' | 'DONE' {
    if (this.state === 'DONE') return 'DONE';

    if (this.state === 'PLAYING') {
      this.timeRemaining -= dt;
      if (this.timeRemaining <= 0) {
        this.timeRemaining = 0;
        this.failWord();
      }
      return 'CONTINUE';
    }

    // COMPLETE / FAILED: hold briefly so the player sees how it went.
    this.gap -= dt;
    if (this.gap > 0) return 'CONTINUE';

    this.index += 1;
    if (this.index >= this.words.length) {
      this.state = 'DONE';
      this.slots = [];
      return 'DONE';
    }
    this.beginWord();
    return 'CONTINUE';
  }

  snapshot(): WordConnectSnapshot {
    if (!this.active) return IDLE_SNAPSHOT;
    return {
      active: true,
      word: this.currentWord,
      progress: this.progress,
      slots: this.slots.map((slot) => ({ ...slot })),
      wordIndex: this.index,
      totalWords: this.words.length,
      wordsCompleted: this.completed,
      timeRemaining: this.timeRemaining,
      status: this.state,
    };
  }

  reset(): void {
    this.words = [];
    this.index = 0;
    this.slots = [];
    this.progress = 0;
    this.completed = 0;
    this.timeRemaining = 0;
    this.gap = 0;
    this.state = 'DONE';
  }

  private beginWord(): void {
    const word = this.words[this.index];
    if (!word) {
      this.state = 'DONE';
      this.slots = [];
      return;
    }
    this.progress = 0;
    this.timeRemaining = WORD_CONNECT_SECONDS;
    this.state = 'PLAYING';
    this.slots = layOutSlots(word);
  }

  private failWord(): 'FAIL' {
    this.state = 'FAILED';
    this.gap = WORD_CONNECT_GAP;
    return 'FAIL';
  }
}

/** Scatters a word's letters across random slots, so order is never spatial. */
function layOutSlots(word: string): WordConnectSlot[] {
  const positions = shuffle([0, 1, 2, 3]).slice(0, word.length);
  return positions
    .map((slot, letterIndex) => ({
      index: slot,
      letter: word[letterIndex],
      direction: SLOT_DIRECTIONS[slot],
      usedAt: null as number | null,
    }))
    .sort((a, b) => a.index - b.index);
}

/** More words connected, bigger hit. Table first, then a flat rate beyond it. */
export function specialAttackDamage(wordsCompleted: number): number {
  const table = SPECIAL_DAMAGE_BY_WORDS;
  if (wordsCompleted < table.length) return table[Math.max(0, wordsCompleted)];
  const extra = wordsCompleted - table.length + 1;
  return table[table.length - 1] + extra * SPECIAL_DAMAGE_EXTRA_WORD;
}
