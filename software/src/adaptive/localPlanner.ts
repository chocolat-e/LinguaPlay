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
      ? 'It has been a while since you practised this, so it is due for review.'
      : 'This is one of the topics you are least sure about right now.',
  }));

  const plan: AiPlan = {
    feedback: {
      headline: report.summary.answered === 0 ? 'Let’s see what you can do' : 'Your next round is ready',
      strengths,
      weaknesses,
      advice: report.motorEvidence.note,
    },
    curriculum: {
      title: 'practice and review',
      rationale: 'These questions focus on the topics you found hardest, with a few older ones mixed back in so you do not forget them.',
      targetConcepts,
      reviewConcepts: report.forgettingAware.dueConcepts.slice(0, 5),
      difficultyMix: { easy: 10, medium: 10, hard: 10 },
      sessionStrategy: 'Questions get easier or harder as you play, based on how you are doing.',
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
      // Authored items carry a real explanation; this only covers the rare item
      // that has none, and the player sees it in the end-of-round review.
      explanation: question.explanation
        ?? `“${question.answers[question.correctAnswer]}” is the right answer here.`,
      misconceptions: question.answers.map((answer, option) =>
        option === question.correctAnswer ? 'none' : `Confused the answer with “${answer}”`,
      ),
      curriculumReason: targetNames.includes(knowledgeComponentFor(question))
        ? 'One of the topics you need most right now.'
        : 'Keeps earlier topics fresh.',
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
    return [`${strongest.component.replaceAll('-', ' ')} is your strongest topic so far.`];
  }
  return ['You finished the round, so your coach now knows where to start.'];
}

function weaknessLines(report: LearnerReport): string[] {
  const weakest = report.punchKT.weakestConcepts[0];
  const misconception = report.misconceptionEvidence[0];
  if (weakest && misconception) {
    return [
      `${weakest.replaceAll('-', ' ')} needs the most practice.`,
      `A mistake you made more than once: ${misconception.label}.`,
    ];
  }
  if (weakest) return [`${weakest.replaceAll('-', ' ')} needs the most practice.`];
  if (report.summary.missed > 0) return ['A few questions ran out of time, so try to answer more of them next round.'];
  return ['Play one more round and your coach will be able to point to a clear weak spot.'];
}
