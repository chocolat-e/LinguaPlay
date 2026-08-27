import QUESTIONS from '../data/questions';
import type { Difficulty, Question } from './types';

const LADDER: Difficulty[] = ['easy', 'medium', 'hard'];

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
 * Serves questions at a requested difficulty without repeating within a
 * session, shuffling the answer order so the correct lane is never predictable.
 */
export class QuestionManager {
  private pool: Question[];
  private used = new Set<number>();

  constructor(pool: Question[] = QUESTIONS) {
    this.pool = pool.slice();
  }

  /** Installs a fully validated between-level curriculum. Never called mid-round. */
  setPool(pool: readonly Question[]): void {
    if (pool.length === 0) return;
    this.pool = pool.slice();
    this.used.clear();
  }

  /**
   * @returns a question at `difficulty`, falling back to the nearest rung of
   * the ladder if that bucket is exhausted, or `null` if nothing is left.
   */
  next(difficulty: Difficulty): Question | null {
    const order = nearestFirst(difficulty);
    for (const level of order) {
      const candidates = this.pool.filter(
        (q) => q.difficulty === level && !this.used.has(q.id),
      );
      if (candidates.length > 0) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        this.used.add(picked.id);
        return withShuffledAnswers(picked);
      }
    }
    // Everything has been served — recycle so a long session never stalls.
    if (this.used.size > 0) {
      this.used.clear();
      return this.next(difficulty);
    }
    return null;
  }

  get remaining(): number {
    return this.pool.length - this.used.size;
  }

  reset(): void {
    this.used.clear();
  }
}

/** Difficulty levels ordered by distance from `difficulty`. */
function nearestFirst(difficulty: Difficulty): Difficulty[] {
  const index = LADDER.indexOf(difficulty);
  return LADDER.slice().sort(
    (a, b) => Math.abs(LADDER.indexOf(a) - index) - Math.abs(LADDER.indexOf(b) - index),
  );
}

/** Randomises which lane holds the correct answer. */
function withShuffledAnswers(question: Question): Question {
  const paired = question.answers.map((text, index) => ({
    text,
    index,
    misconception: question.misconceptions?.[index],
  }));
  const shuffled = shuffle(paired);
  return {
    ...question,
    answers: shuffled.map((entry) => entry.text),
    correctAnswer: shuffled.findIndex((entry) => entry.index === question.correctAnswer),
    misconceptions: question.misconceptions
      ? shuffled.map((entry) => entry.misconception ?? 'none')
      : undefined,
  };
}
