import type { ConceptReport, LearnerReport } from './contracts';
import type { Difficulty, Outcome } from '../game/types';

const LADDER: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const MIN_LANGUAGE_ANSWERS = 5;
const LOW_LANGUAGE_ACCURACY = 0.5;
const STALE_EVIDENCE_HOURS = 24;
const STRONG_FORGETTING_COUNT = 2;

interface StartDifficultyReport {
  recentEvidence: ReadonlyArray<{ outcome: Outcome }>;
  punchKT: {
    concepts: ReadonlyArray<Pick<ConceptReport, 'component' | 'hoursSinceLastEvidence'>>;
  };
  forgettingAware: Pick<LearnerReport['forgettingAware'], 'dueConcepts'>;
}

/**
 * Keeps the last demonstrated rung unless the evidence calls for one
 * conservative step down. The first level still starts at easy in GameManager.
 */
export function selectNextLevelStartDifficulty(
  endingDifficulty: Difficulty,
  report: StartDifficultyReport,
): Difficulty {
  const languageAnswers = report.recentEvidence.filter((item) => item.outcome !== 'MISS');
  const correct = languageAnswers.filter((item) => item.outcome === 'CORRECT').length;
  const languageAccuracy = languageAnswers.length === 0 ? 0 : correct / languageAnswers.length;

  const due = new Set(report.forgettingAware.dueConcepts);
  const staleDueConcepts = report.punchKT.concepts.filter(
    (concept) => due.has(concept.component)
      && concept.hoursSinceLastEvidence !== null
      && concept.hoursSinceLastEvidence >= STALE_EVIDENCE_HOURS,
  ).length;

  const needsSupport = languageAnswers.length < MIN_LANGUAGE_ANSWERS
    || languageAccuracy < LOW_LANGUAGE_ACCURACY
    || staleDueConcepts >= STRONG_FORGETTING_COUNT;

  if (!needsSupport) return endingDifficulty;
  const index = LADDER.indexOf(endingDifficulty);
  return LADDER[Math.max(0, index - 1)];
}
