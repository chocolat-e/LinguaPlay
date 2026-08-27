import QUESTIONS from '../data/questions';
import { knowledgeComponentFor } from './questionProfile';
import {
  DIFFICULTIES,
  QUESTIONS_PER_DIFFICULTY,
  planToQuestions,
  type AdaptivePackage,
  type AiPlan,
  type LearnerReport,
} from './contracts';
import type { Category } from '../game/types';

/** Safe offline curriculum used when no API key/network is available. */
export function createLocalPlan(report: LearnerReport): AdaptivePackage {
  const ranked = report.punchKT.weakestConcepts.length > 0
    ? report.punchKT.weakestConcepts
    : report.punchKT.uncertainConcepts;
  const rankedQuestions = QUESTIONS.slice().sort((a, b) => {
    const aRank = rankOf(ranked, knowledgeComponentFor(a));
    const bRank = rankOf(ranked, knowledgeComponentFor(b));
    return aRank - bRank || a.id - b.id;
  });
  const ordered = DIFFICULTIES.flatMap((difficulty) =>
    rankedQuestions
      .filter((question) => question.difficulty === difficulty)
      .slice(0, QUESTIONS_PER_DIFFICULTY),
  );

  const weaknesses = weaknessLines(report);
  const strengths = strengthLines(report);
  const targetNames = ranked.length > 0
    ? ranked.slice(0, 4)
    : ordered.slice(0, 3).map(knowledgeComponentFor);
  const targetConcepts = targetNames.map((component, index) => ({
    component,
    category: categoryFor(report, component),
    priority: Math.max(1, 5 - index),
    reason: report.forgettingAware.dueConcepts.includes(component)
      ? 'Retention is below the review threshold.'
      : 'Current mastery or confidence is among the learner’s lowest.',
  }));

  const plan: AiPlan = {
    feedback: {
      headline: report.summary.answered === 0 ? 'Let’s collect a clean baseline' : 'Your next focused round is ready',
      strengths,
      weaknesses,
      advice: report.motorEvidence.note,
    },
    curriculum: {
      title: 'PunchKT focus and review',
      rationale: 'This offline plan prioritizes weak and uncertain components, then mixes in spaced review while live difficulty remains deterministic.',
      targetConcepts,
      reviewConcepts: report.forgettingAware.dueConcepts.slice(0, 5),
      difficultyMix: { easy: 10, medium: 10, hard: 10 },
      sessionStrategy: 'Use the normal rolling accuracy policy during play; target selection comes from this prevalidated pool.',
    },
    questions: ordered.map((question, index) => ({
      sequence: index + 1,
      question: question.question,
      answers: question.answers,
      correctAnswer: question.correctAnswer,
      difficulty: question.difficulty,
      category: question.category,
      knowledgeComponent: knowledgeComponentFor(question),
      learningObjective: `Practise ${knowledgeComponentFor(question).replaceAll('-', ' ')}.`,
      explanation: `“${question.answers[question.correctAnswer]}” is the correct answer.`,
      misconceptions: question.answers.map((answer, option) =>
        option === question.correctAnswer ? 'none' : `Confused the answer with “${answer}”`,
      ),
      curriculumReason: targetNames.includes(knowledgeComponentFor(question))
        ? 'Targets a current learning priority.'
        : 'Provides mixed practice and retention review.',
    })),
  };

  return {
    source: 'local',
    model: 'deterministic-fallback',
    generatedAt: new Date().toISOString(),
    feedback: plan.feedback,
    curriculum: plan.curriculum,
    questions: planToQuestions(plan, 'local'),
  };
}

function rankOf(ranked: readonly string[], component: string): number {
  const index = ranked.indexOf(component);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function categoryFor(report: LearnerReport, component: string): Category {
  return report.punchKT.concepts.find((concept) => concept.component === component)?.category ?? 'vocabulary';
}

function strengthLines(report: LearnerReport): string[] {
  const strongest = report.punchKT.concepts
    .filter((concept) => concept.attempts > 0)
    .slice()
    .sort((a, b) => b.mastery - a.mastery)[0];
  if (strongest) {
    return [`${strongest.component.replaceAll('-', ' ')} is currently your strongest measured skill.`];
  }
  return ['You completed the round and created a baseline for personalization.'];
}

function weaknessLines(report: LearnerReport): string[] {
  const weakest = report.punchKT.weakestConcepts[0];
  const misconception = report.misconceptionEvidence[0];
  if (weakest && misconception) {
    return [
      `${weakest.replaceAll('-', ' ')} needs the most reinforcement.`,
      `A repeated pattern was: ${misconception.label}.`,
    ];
  }
  if (weakest) return [`${weakest.replaceAll('-', ' ')} needs the most reinforcement.`];
  if (report.summary.missed > 0) return ['Some blocks escaped, so more answer-choice evidence is needed.'];
  return ['The model needs another round before identifying a stable weakness.'];
}
