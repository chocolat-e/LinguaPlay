import { describe, expect, it } from 'vitest';
import { selectNextLevelStartDifficulty } from './startDifficulty';
import type { Outcome } from '../game/types';

function report(
  outcomes: Outcome[],
  dueConcepts: string[] = [],
  staleHours: Record<string, number | null> = {},
) {
  return {
    recentEvidence: outcomes.map((outcome) => ({ outcome })),
    punchKT: {
      concepts: Object.entries(staleHours).map(([component, hoursSinceLastEvidence]) => ({
        component,
        hoursSinceLastEvidence,
      })),
    },
    forgettingAware: { dueConcepts },
  };
}

describe('selectNextLevelStartDifficulty', () => {
  it('keeps the demonstrated ending difficulty when language evidence is strong', () => {
    const evidence = report(['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'WRONG']);
    expect(selectNextLevelStartDifficulty('hard', evidence)).toBe('hard');
  });

  it('steps down once when language accuracy is below 50 percent', () => {
    const evidence = report(['WRONG', 'WRONG', 'CORRECT', 'WRONG', 'CORRECT']);
    expect(selectNextLevelStartDifficulty('hard', evidence)).toBe('medium');
  });

  it('steps down when too few answer choices were observed', () => {
    const evidence = report(['CORRECT', 'CORRECT', 'CORRECT', 'MISS', 'MISS']);
    expect(selectNextLevelStartDifficulty('medium', evidence)).toBe('easy');
  });

  it('steps down for a strong forgetting signal but never below easy', () => {
    const evidence = report(
      ['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'CORRECT'],
      ['articles', 'conditionals'],
      { articles: 48, conditionals: 72 },
    );
    expect(selectNextLevelStartDifficulty('medium', evidence)).toBe('easy');
    expect(selectNextLevelStartDifficulty('easy', evidence)).toBe('easy');
  });

  it('does not confuse newly identified weak concepts with forgetting', () => {
    const evidence = report(
      ['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'CORRECT'],
      ['articles', 'conditionals'],
      { articles: 0, conditionals: 2 },
    );
    expect(selectNextLevelStartDifficulty('hard', evidence)).toBe('hard');
  });
});
