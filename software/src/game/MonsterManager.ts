import {
  MONSTER_CHARGE_SECONDS,
  MONSTER_DAMAGE_BASE,
  MONSTER_DAMAGE_COMBO_CAP,
  MONSTER_DAMAGE_COMBO_STEP,
  MONSTER_DAMAGE_QUALITY,
  MONSTER_MAX_HP,
} from './constants';
import type { HitQuality, MonsterPhase } from './types';

/**
 * The opponent: hit points, a wind-up timer, and a phase the scene animates.
 *
 * Same shape as the other managers — plain state plus small methods, no React,
 * no Three.js. `GameManager` decides *when* the monster acts; this decides what
 * happens when it does.
 */
export class MonsterManager {
  hp = MONSTER_MAX_HP;
  phase: MonsterPhase = 'IDLE';
  /** Seconds left of the wind-up, or 0 when not charging. */
  chargeRemaining = 0;
  /** Simulation time the phase last changed — the scene animates from this. */
  phaseTime = 0;

  get maxHp(): number {
    return MONSTER_MAX_HP;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** Remaining health, 0..1. */
  get hpFraction(): number {
    return Math.max(0, Math.min(1, this.hp / MONSTER_MAX_HP));
  }

  /**
   * Damage one landed correct answer is worth: a base hit, a bonus for how
   * cleanly the punch was timed, and a bonus that grows with the combo.
   */
  damageFor(quality: HitQuality | null, combo: number): number {
    const timing = quality === null ? 0 : MONSTER_DAMAGE_QUALITY[quality];
    const streak = Math.min(
      MONSTER_DAMAGE_COMBO_CAP,
      Math.max(0, combo - 1) * MONSTER_DAMAGE_COMBO_STEP,
    );
    return MONSTER_DAMAGE_BASE + timing + streak;
  }

  /** @returns the damage actually dealt, after clamping at zero HP. */
  applyDamage(amount: number, now: number): number {
    if (!this.alive) return 0;
    const dealt = Math.min(Math.max(0, Math.round(amount)), this.hp);
    this.hp -= dealt;
    this.setPhase(this.alive ? 'HURT' : 'DEFEATED', now);
    return dealt;
  }

  beginCharge(now: number): void {
    if (!this.alive) return;
    this.chargeRemaining = MONSTER_CHARGE_SECONDS;
    this.setPhase('CHARGING', now);
  }

  /**
   * Run the wind-up down.
   * @returns true on the single frame the blow is released.
   */
  tickCharge(dt: number, now: number): boolean {
    if (this.phase !== 'CHARGING') return false;
    this.chargeRemaining -= dt;
    if (this.chargeRemaining > 0) return false;
    this.chargeRemaining = 0;
    this.setPhase('STRIKING', now);
    return true;
  }

  /** Back to a resting stance, unless it is already down for good. */
  settle(now: number): void {
    if (this.phase === 'DEFEATED') return;
    this.chargeRemaining = 0;
    this.setPhase('IDLE', now);
  }

  setPhase(phase: MonsterPhase, now: number): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.phaseTime = now;
  }

  reset(now = 0): void {
    this.hp = MONSTER_MAX_HP;
    this.phase = 'IDLE';
    this.chargeRemaining = 0;
    this.phaseTime = now;
  }
}
