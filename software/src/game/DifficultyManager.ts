import type { AnswerRecord, Category, Difficulty } from './types';

const LADDER: Difficulty[] = ['easy', 'medium', 'hard'];

/** Rolling window used to decide whether to step the difficulty. */
const WINDOW = 5;
/** Questions to wait after a change before considering another one. */
const COOLDOWN = 3;
const STEP_UP_ACCURACY = 0.8;
const STEP_DOWN_ACCURACY = 0.5;

export interface CategoryStat {
  attempts: number;
  correct: number;
}

/**
 * Simple adaptive engine: accuracy over the last few answers nudges the
 * difficulty up or down.
 *
 * It also accumulates the signals a richer model would need later — reaction
 * time, per-category and per-difficulty mistake history — so swapping this
 * heuristic for a real learner model means rewriting one method, `evaluate`.
 */
export class DifficultyManager {
  private current: Difficulty = 'easy';
  private cooldown = 0;
  private window: boolean[] = [];
  private reactionTimes: number[] = [];
  readonly byCategory = new Map<Category, CategoryStat>();
  readonly byDifficulty = new Map<Difficulty, CategoryStat>();
  /** Questions the player got wrong — candidates for later re-teaching. */
  readonly mistakes: AnswerRecord[] = [];

  get difficulty(): Difficulty {
    return this.current;
  }

  /** Mean reaction time over correct answers, in seconds. */
  get averageReaction(): number {
    if (this.reactionTimes.length === 0) return 0;
    return this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length;
  }

  get rollingAccuracy(): number {
    if (this.window.length === 0) return 0;
    return this.window.filter(Boolean).length / this.window.length;
  }

  /**
   * Feed one answer in and find out whether the difficulty should change.
   * @returns the direction of the change, or `null` to stay put.
   */
  evaluate(record: AnswerRecord, enabled: boolean): 'up' | 'down' | null {
    // An escaped block contains no answer choice. It is motor evidence, not
    // evidence that the learner does or does not know the English concept.
    if (record.outcome === 'MISS') return null;
    const success = record.outcome === 'CORRECT';

    this.window.push(success);
    if (this.window.length > WINDOW) this.window.shift();

    if (success) this.reactionTimes.push(record.reactionTime);
    else this.mistakes.push(record);

    bump(this.byCategory, record.category, success);
    bump(this.byDifficulty, record.difficulty, success);

    if (!enabled) return null;
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return null;
    }
    if (this.window.length < WINDOW) return null;

    const accuracy = this.rollingAccuracy;
    const index = LADDER.indexOf(this.current);

    if (accuracy > STEP_UP_ACCURACY && index < LADDER.length - 1) {
      this.current = LADDER[index + 1];
      this.cooldown = COOLDOWN;
      this.window = [];
      return 'up';
    }
    if (accuracy < STEP_DOWN_ACCURACY && index > 0) {
      this.current = LADDER[index - 1];
      this.cooldown = COOLDOWN;
      this.window = [];
      return 'down';
    }
    return null;
  }

  /** The category the player is weakest at — for a future targeted drill mode. */
  get weakestCategory(): Category | null {
    let worst: Category | null = null;
    let worstRate = 1;
    for (const [category, stat] of this.byCategory) {
      if (stat.attempts < 2) continue;
      const rate = stat.correct / stat.attempts;
      if (rate < worstRate) {
        worstRate = rate;
        worst = category;
      }
    }
    return worst;
  }

  reset(startAt: Difficulty = 'easy'): void {
    this.current = startAt;
    this.cooldown = 0;
    this.window = [];
    this.reactionTimes = [];
    this.byCategory.clear();
    this.byDifficulty.clear();
    this.mistakes.length = 0;
  }
}

function bump<K>(map: Map<K, CategoryStat>, key: K, success: boolean): void {
  const stat = map.get(key) ?? { attempts: 0, correct: 0 };
  stat.attempts += 1;
  if (success) stat.correct += 1;
  map.set(key, stat);
}
