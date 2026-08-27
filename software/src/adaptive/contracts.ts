import { z } from 'zod';
import type { Category, Difficulty, Question } from '../game/types.js';

export const CATEGORIES = [
  'vocabulary',
  'grammar',
  'synonym',
  'antonym',
  'sentence',
  'everyday',
] as const satisfies readonly Category[];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const satisfies readonly Difficulty[];
export const ADAPTIVE_POOL_SIZE = 30;
export const QUESTIONS_PER_DIFFICULTY = 10;

export const TargetConceptSchema = z.object({
  component: z.string().min(2).max(80),
  category: z.enum(CATEGORIES),
  priority: z.number().int().min(1).max(5),
  reason: z.string().min(5).max(220),
});

export const CurriculumSchema = z.object({
  title: z.string().min(3).max(80),
  rationale: z.string().min(10).max(500),
  targetConcepts: z.array(TargetConceptSchema).min(1).max(6),
  reviewConcepts: z.array(z.string().min(2).max(80)).max(5),
  difficultyMix: z.object({
    easy: z.literal(QUESTIONS_PER_DIFFICULTY),
    medium: z.literal(QUESTIONS_PER_DIFFICULTY),
    hard: z.literal(QUESTIONS_PER_DIFFICULTY),
  }),
  sessionStrategy: z.string().min(10).max(350),
});

export const CoachFeedbackSchema = z.object({
  headline: z.string().min(3).max(100),
  strengths: z.array(z.string().min(3).max(180)).min(1).max(3),
  weaknesses: z.array(z.string().min(3).max(180)).min(1).max(3),
  advice: z.string().min(10).max(350),
});

/** Schema given directly to the Responses API as a strict structured output. */
export const AiQuestionSchema = z.object({
  sequence: z.number().int().min(1).max(ADAPTIVE_POOL_SIZE),
  question: z.string().min(4).max(140),
  answers: z.array(z.string().min(1).max(55)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  difficulty: z.enum(DIFFICULTIES),
  category: z.enum(CATEGORIES),
  knowledgeComponent: z.string().min(2).max(80),
  learningObjective: z.string().min(5).max(180),
  explanation: z.string().min(8).max(260),
  /** Put "none" at the correct option and a diagnostic label at wrong options. */
  misconceptions: z.array(z.string().min(2).max(120)).length(4),
  curriculumReason: z.string().min(5).max(180),
});

export const AiPlanSchema = z.object({
  feedback: CoachFeedbackSchema,
  curriculum: CurriculumSchema,
  questions: z.array(AiQuestionSchema).length(ADAPTIVE_POOL_SIZE),
});

export type AiPlan = z.infer<typeof AiPlanSchema>;
export type CurriculumPlan = z.infer<typeof CurriculumSchema>;
export type CoachFeedback = z.infer<typeof CoachFeedbackSchema>;

export interface ConceptReport {
  component: string;
  category: Category;
  attempts: number;
  correct: number;
  wrong: number;
  mastery: number;
  uncertainty: number;
  retention: number;
  halfLifeHours: number;
  hoursSinceLastEvidence: number | null;
}

export interface MisconceptionReport {
  component: string;
  label: string;
  count: number;
  lastSeenAt: string;
}

export interface LearnerReport {
  version: 1;
  generatedAt: string;
  sessionNumber: number;
  game: {
    name: 'Punch English';
    format: 'four-lane rhythm boxing';
    sessionQuestions: number;
  };
  summary: {
    answered: number;
    correct: number;
    wrong: number;
    missed: number;
    accuracy: number;
    averageReactionSeconds: number;
  };
  punchKT: {
    concepts: ConceptReport[];
    weakestConcepts: string[];
    uncertainConcepts: string[];
  };
  misconceptionEvidence: MisconceptionReport[];
  forgettingAware: {
    dueConcepts: string[];
    retentionThreshold: number;
  };
  motorEvidence: {
    landedPunchRate: number;
    earlyPunchRate: number;
    averageReactionSeconds: number;
    note: string;
  };
  recentEvidence: Array<{
    component: string;
    category: Category;
    outcome: 'CORRECT' | 'WRONG' | 'MISS';
    selectedText: string | null;
    correctText: string;
    misconception: string | null;
    reactionTimeSeconds: number;
    punchQuality: string | null;
  }>;
}

export interface AdaptivePackage {
  source: 'llm' | 'local';
  model: string;
  generatedAt: string;
  feedback: CoachFeedback;
  curriculum: CurriculumPlan;
  questions: Question[];
}

export type CoachStatus = 'idle' | 'loading' | 'ready' | 'fallback';

export interface CoachState {
  status: CoachStatus;
  package: AdaptivePackage | null;
  message: string | null;
}

export function planToQuestions(plan: AiPlan, source: 'llm' | 'local'): Question[] {
  const idBase = Date.now() * 100;
  return plan.questions.map((question, index) => ({
    id: idBase + index,
    question: question.question,
    answers: question.answers,
    correctAnswer: question.correctAnswer,
    difficulty: question.difficulty,
    category: question.category,
    knowledgeComponent: question.knowledgeComponent,
    learningObjective: question.learningObjective,
    explanation: question.explanation,
    misconceptions: question.misconceptions,
    curriculumReason: question.curriculumReason,
    source,
  }));
}

/** Deterministic semantic checks beyond JSON-schema shape. */
export function findPlanIssues(plan: AiPlan): string[] {
  const issues: string[] = [];
  const sequences = new Set<number>();
  const stems = new Set<string>();

  for (const item of plan.questions) {
    if (sequences.has(item.sequence)) issues.push(`Duplicate sequence ${item.sequence}.`);
    sequences.add(item.sequence);

    const stem = item.question.trim().toLocaleLowerCase();
    if (stems.has(stem)) issues.push(`Duplicate question: ${item.question}`);
    stems.add(stem);

    const answers = item.answers.map((answer) => answer.trim().toLocaleLowerCase());
    if (new Set(answers).size !== 4) issues.push(`Question ${item.sequence} has duplicate answers.`);

    item.misconceptions.forEach((label, option) => {
      const isNone = label.trim().toLocaleLowerCase() === 'none';
      if (option === item.correctAnswer && !isNone) {
        issues.push(`Question ${item.sequence}: correct option misconception must be "none".`);
      }
      if (option !== item.correctAnswer && isNone) {
        issues.push(`Question ${item.sequence}: wrong option ${option} needs a misconception.`);
      }
    });
  }

  const mix = plan.curriculum.difficultyMix;
  if (mix.easy + mix.medium + mix.hard !== ADAPTIVE_POOL_SIZE) {
    issues.push(`Difficulty mix must total ${ADAPTIVE_POOL_SIZE}.`);
  }
  for (const [difficulty, expected] of Object.entries(mix)) {
    const actual = plan.questions.filter((item) => item.difficulty === difficulty).length;
    if (actual !== expected) issues.push(`${difficulty} mix says ${expected}, but has ${actual}.`);
  }

  return issues;
}
