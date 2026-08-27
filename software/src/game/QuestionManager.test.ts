import { describe, expect, it } from 'vitest';
import QUESTIONS from '../data/questions';
import { QuestionManager } from './QuestionManager';
import type { Question } from './types';

describe('QuestionManager', () => {
  it('ships a balanced 30-question static pool', () => {
    expect(QUESTIONS).toHaveLength(30);
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      expect(QUESTIONS.filter((question) => question.difficulty === difficulty)).toHaveLength(10);
    }
  });

  it('keeps misconceptions aligned when answer lanes are shuffled', () => {
    const question: Question = {
      id: 100,
      question: 'Choose one.',
      answers: ['A', 'B', 'C', 'D'],
      correctAnswer: 2,
      difficulty: 'easy',
      category: 'grammar',
      misconceptions: ['mistake-a', 'mistake-b', 'none', 'mistake-d'],
    };
    const manager = new QuestionManager([question]);
    const served = manager.next('easy');

    expect(served).not.toBeNull();
    const originalLabels = new Map(question.answers.map((answer, index) => [answer, question.misconceptions?.[index]]));
    served?.answers.forEach((answer, index) => {
      expect(served.misconceptions?.[index]).toBe(originalLabels.get(answer));
    });
    expect(served?.answers[served.correctAnswer]).toBe('C');
  });
});
