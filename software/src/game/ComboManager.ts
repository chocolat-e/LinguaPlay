import { MULTIPLIER_TIERS } from './constants';

/** Tracks the current streak and the score multiplier it earns. */
export class ComboManager {
  private combo = 0;
  private best = 0;

  increment(): number {
    this.combo += 1;
    if (this.combo > this.best) this.best = this.combo;
    return this.combo;
  }

  break(): void {
    this.combo = 0;
  }

  get current(): number {
    return this.combo;
  }

  get bestCombo(): number {
    return this.best;
  }

  get multiplier(): number {
    for (const tier of MULTIPLIER_TIERS) {
      if (this.combo >= tier.minCombo) return tier.multiplier;
    }
    return 1;
  }

  /** True when this combo just crossed into a higher multiplier tier. */
  isMilestone(): boolean {
    return MULTIPLIER_TIERS.some((tier) => tier.minCombo === this.combo && tier.minCombo > 0);
  }

  reset(): void {
    this.combo = 0;
    this.best = 0;
  }
}
