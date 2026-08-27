import { QUALITY_BONUS, SCORE_BASE, WRONG_PENALTY } from './constants';
import type { AnswerRecord, HitQuality } from './types';

/** Owns the score number and the running session statistics. */
export class ScoreManager {
  private score = 0;
  private correct = 0;
  private wrong = 0;
  private missed = 0;
  private reactionTotal = 0;
  readonly history: AnswerRecord[] = [];

  /** @returns points awarded (always positive). */
  award(quality: HitQuality, multiplier: number): number {
    const points = (SCORE_BASE + QUALITY_BONUS[quality]) * multiplier;
    this.score += points;
    this.correct += 1;
    return points;
  }

  /** @returns points lost (negative). */
  penalise(): number {
    const lost = Math.min(WRONG_PENALTY, this.score);
    this.score -= lost;
    this.wrong += 1;
    return -lost;
  }

  registerMiss(): void {
    this.missed += 1;
  }

  record(entry: AnswerRecord): void {
    this.history.push(entry);
    this.reactionTotal += entry.reactionTime;
  }

  get value(): number {
    return this.score;
  }

  get correctCount(): number {
    return this.correct;
  }

  get wrongCount(): number {
    return this.wrong;
  }

  get missedCount(): number {
    return this.missed;
  }

  get answered(): number {
    return this.correct + this.wrong + this.missed;
  }

  /** Correct answers over everything attempted, 0..1. */
  get accuracy(): number {
    const total = this.answered;
    return total === 0 ? 0 : this.correct / total;
  }

  get averageReaction(): number {
    return this.history.length === 0 ? 0 : this.reactionTotal / this.history.length;
  }

  reset(): void {
    this.score = 0;
    this.correct = 0;
    this.wrong = 0;
    this.missed = 0;
    this.reactionTotal = 0;
    this.history.length = 0;
  }
}
