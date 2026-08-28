import { describe, expect, it } from 'vitest';
import {
  SPECIAL_DAMAGE_BY_WORDS,
  SPECIAL_DAMAGE_EXTRA_WORD,
  WORD_CONNECT_GAP,
  WORD_CONNECT_MAX_LETTERS,
  WORD_CONNECT_SECONDS,
} from './constants';
import { WordConnectManager, specialAttackDamage } from './WordConnectManager';
import { collectWords, pickWordConnectWords } from './wordBank';
import type { Question } from './types';

/** Punches the slots holding `word` in order, the way a player would. */
function connect(manager: WordConnectManager, word: string): void {
  for (let i = 0; i < word.length; i += 1) {
    const slot = manager.liveSlots.find(
      (entry) => entry.letter === word[i] && entry.usedAt === null,
    );
    manager.punch(slot?.index ?? null);
  }
}

describe('WordConnectManager', () => {
  it('scatters every letter of the word across distinct slots', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT']);

    expect(manager.liveSlots).toHaveLength(3);
    expect(manager.liveSlots.map((slot) => slot.letter).sort()).toEqual(['A', 'C', 'T']);
    expect(new Set(manager.liveSlots.map((slot) => slot.index)).size).toBe(3);
  });

  it('banks a word when its letters are punched in order', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT']);
    connect(manager, 'CAT');

    expect(manager.status).toBe('COMPLETE');
    expect(manager.wordsCompleted).toBe(1);
  });

  it('fails the word on a wrong letter', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT']);

    const wrong = manager.liveSlots.find((slot) => slot.letter !== 'C');
    expect(manager.punch(wrong?.index ?? null)).toBe('FAIL');
    expect(manager.status).toBe('FAILED');
    expect(manager.wordsCompleted).toBe(0);
  });

  it('fails the word when the player punches facing nothing', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT']);
    expect(manager.punch(null)).toBe('FAIL');
    expect(manager.status).toBe('FAILED');
  });

  it('handles a repeated letter, matching whichever copy is still free', () => {
    const manager = new WordConnectManager();
    manager.start(['BOOK']);
    connect(manager, 'BOOK');

    expect(manager.status).toBe('COMPLETE');
    expect(manager.wordsCompleted).toBe(1);
  });

  it('runs out of time and moves on', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT', 'TREE']);

    manager.tick(WORD_CONNECT_SECONDS + 0.01);
    expect(manager.status).toBe('FAILED');

    manager.tick(WORD_CONNECT_GAP + 0.01);
    expect(manager.status).toBe('PLAYING');
    expect(manager.currentWord).toBe('TREE');
  });

  it('reports DONE once every word has been played', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT']);
    connect(manager, 'CAT');

    expect(manager.tick(WORD_CONNECT_GAP + 0.01)).toBe('DONE');
    expect(manager.active).toBe(false);
    expect(manager.wordsCompleted).toBe(1);
  });

  it('ignores punches thrown between words', () => {
    const manager = new WordConnectManager();
    manager.start(['CAT', 'TREE']);
    connect(manager, 'CAT');
    expect(manager.punch(0)).toBe('IGNORED');
    expect(manager.wordsCompleted).toBe(1);
  });
});

describe('specialAttackDamage', () => {
  it('scales with the number of words connected', () => {
    expect(specialAttackDamage(0)).toBe(0);
    expect(specialAttackDamage(1)).toBeLessThan(specialAttackDamage(2));
    expect(specialAttackDamage(2)).toBeLessThan(specialAttackDamage(3));
  });

  it('keeps rewarding words beyond the table', () => {
    const last = SPECIAL_DAMAGE_BY_WORDS[SPECIAL_DAMAGE_BY_WORDS.length - 1];
    expect(specialAttackDamage(SPECIAL_DAMAGE_BY_WORDS.length)).toBe(
      last + SPECIAL_DAMAGE_EXTRA_WORD,
    );
  });
});

describe('wordBank', () => {
  const question = (id: number, text: string, answers: string[]): Question => ({
    id,
    question: text,
    answers,
    correctAnswer: 0,
    difficulty: 'easy',
    category: 'vocabulary',
  });

  it('only collects words within the letter limit', () => {
    const words = collectWords(['Cat', 'elephant', 'a', 'BOOK', "don't"]);
    expect(words).toContain('CAT');
    expect(words).toContain('BOOK');
    expect(words).not.toContain('ELEPHANT');
    for (const word of words) expect(word.length).toBeLessThanOrEqual(WORD_CONNECT_MAX_LETTERS);
  });

  it('prefers vocabulary the player just answered with', () => {
    const pool = [question(1, 'Pick one', ['ROAD', 'LAKE', 'SONG', 'GOLD'])];
    const words = pickWordConnectWords(['TREE'], pool, 1);
    expect(words).toEqual(['TREE']);
  });

  it('always produces a valid puzzle, even from unusable questions', () => {
    // Nothing here is short enough — the fixed list has to cover it, so
    // reaching the streak can never hand the player an unbuildable word.
    const pool = [question(1, 'Which is longest?', ['elephant', 'crocodile', 'porcupine'])];
    const words = pickWordConnectWords([], pool, 3);

    expect(words).toHaveLength(3);
    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(WORD_CONNECT_MAX_LETTERS);
    }
  });
});
