import { describe, expect, it } from 'vitest';
import { PunchKTLearner } from './PunchKTLearner';
import { createLocalPlan } from './localPlanner';
import type { AnswerRecord, SessionStats } from '../game/types';

const NOW = Date.parse('2026-08-27T10:00:00.000Z');

function record(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    questionId: 3,
    difficulty: 'easy',
    category: 'grammar',
    outcome: 'CORRECT',
    reactionTime: 2.1,
    quality: 'GREAT',
    selectedAnswer: 1,
    correctAnswer: 1,
    selectedText: 'goes',
    correctText: 'goes',
    knowledgeComponent: 'present-simple-third-person',
    misconception: null,
    recordedAt: NOW,
    ...overrides,
  };
}

function stats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    score: 100,
    combo: 1,
    bestCombo: 1,
    multiplier: 1,
    correct: 1,
    wrong: 0,
    missed: 0,
    answered: 1,
    totalQuestions: 20,
    accuracy: 1,
    averageReaction: 2.1,
    difficulty: 'easy',
    ...overrides,
  };
}

describe('PunchKTLearner', () => {
  it('separates missed blocks from English knowledge evidence', () => {
    const learner = new PunchKTLearner();
    const correct = record();
    const miss = record({
      outcome: 'MISS',
      quality: null,
      selectedAnswer: null,
      selectedText: null,
      recordedAt: NOW + 1_000,
    });
    learner.record(correct);
    learner.record(miss);

    const report = learner.buildReport(
      [correct, miss],
      stats({ missed: 1, answered: 2, accuracy: 0.5 }),
      NOW + 2_000,
    );

    expect(report.punchKT.concepts[0]).toMatchObject({ attempts: 1, correct: 1, wrong: 0 });
    expect(report.motorEvidence.landedPunchRate).toBe(0.5);
  });

  it('records distractor misconceptions and lowers retention over time', () => {
    const learner = new PunchKTLearner();
    const wrong = record({
      outcome: 'WRONG',
      quality: 'GOOD',
      selectedAnswer: 0,
      selectedText: 'go',
      misconception: 'Used the base verb after third-person singular',
    });
    learner.record(wrong);

    const recent = learner.buildReport([wrong], stats({ correct: 0, wrong: 1, accuracy: 0 }), NOW);
    const later = learner.buildReport([wrong], stats({ correct: 0, wrong: 1, accuracy: 0 }), NOW + 72 * 60 * 60 * 1000);

    expect(recent.misconceptionEvidence[0].label).toContain('base verb');
    expect(later.punchKT.concepts[0].retention).toBeLessThan(recent.punchKT.concepts[0].retention);
    expect(later.forgettingAware.dueConcepts).toContain('present-simple-third-person');
  });

  it('provides a balanced 30-question local fallback', () => {
    const learner = new PunchKTLearner();
    const answer = record();
    learner.record(answer);
    const plan = createLocalPlan(learner.buildReport([answer], stats(), NOW));

    expect(plan.source).toBe('local');
    expect(plan.questions).toHaveLength(30);
    expect(plan.curriculum.difficultyMix).toEqual({ easy: 10, medium: 10, hard: 10 });
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      expect(plan.questions.filter((question) => question.difficulty === difficulty)).toHaveLength(10);
    }
    for (const question of plan.questions) {
      expect(question.answers).toHaveLength(4);
      expect(question.correctAnswer).toBeGreaterThanOrEqual(0);
      expect(question.correctAnswer).toBeLessThan(4);
    }
  });
});
