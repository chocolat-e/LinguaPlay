/**
 * Deterministic measurements over one generated plan.
 *
 * Everything here is computable without a human and without a second model, so
 * it can be re-run on any future prompt or model change and compared directly.
 */
import { findPlanIssues, type AiPlan, type LearnerReport } from '../src/adaptive/contracts';

/**
 * Internal and learning-science vocabulary the system prompt forbids in
 * anything the player reads. Multi-word entries are matched as phrases.
 */
export const BANNED_TERMS = [
  'punchkt',
  'knowledge component',
  'mastery',
  'uncertainty',
  'retention',
  'spaced practice',
  'forgetting curve',
  'misconception',
  'diagnostic',
  'baseline',
  'evidence',
  'motor',
  'model',
  'llm',
  'prompt',
  'schema',
  'validated',
  'deterministic',
  'adaptive',
  'pool',
  'curriculum',
] as const;

/** Softer guidance from the prompt ("say topic instead of concept"). */
export const DISCOURAGED_TERMS = ['concept', 'retrieval practice'] as const;

export interface TermHit {
  term: string;
  field: string;
  excerpt: string;
}

export interface PlanMetrics {
  /** ---- structural ---- */
  semanticIssues: string[];
  issueKinds: string[];
  difficultyCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  categoriesUsed: number;

  /** ---- item-writing quality ---- */
  positionCounts: [number, number, number, number];
  positionChiSquare: number;
  positionBalanced: boolean;
  /** Options at index 3 are never served: the game shows three lanes. */
  correctAtIndex3: number;
  longestOptionIsCorrect: number;
  shortestOptionIsCorrect: number;
  duplicateStems: number;
  nearDuplicatePairs: number;
  meanStemWords: number;

  /** ---- misconception labelling ---- */
  distinctMisconceptionRate: number;
  genericMisconceptionRate: number;

  /** ---- curriculum targeting ---- */
  targetPrecisionStrict: number;
  targetPrecisionFuzzy: number;
  weakConceptRecall: number;
  dueConceptRecall: number;
  misconceptionCoverage: number;
  itemsOnCurriculum: number;

  /** ---- player-facing language ---- */
  bannedHits: TermHit[];
  discouragedHits: TermHit[];
  readingGrade: number;
  playerWordCount: number;

  /** ---- novelty ---- */
  novelStemRate: number;
}

const normalise = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const tokens = (value: string): Set<string> =>
  new Set(normalise(value).split(' ').filter(Boolean));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Concept names travel from the report into the plan as free text, so
 * "first-conditional" and "first conditional" have to count as the same thing.
 */
export function conceptMatchesFuzzy(a: string, b: string): boolean {
  const left = normalise(a);
  const right = normalise(b);
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return jaccard(tokens(a), tokens(b)) >= 0.6;
}

const conceptMatchesStrict = (a: string, b: string): boolean => normalise(a) === normalise(b);

function ratioMatched(
  candidates: readonly string[],
  pool: readonly string[],
  matcher: (a: string, b: string) => boolean,
): number {
  if (candidates.length === 0) return Number.NaN;
  const matched = candidates.filter((candidate) =>
    pool.some((entry) => matcher(candidate, entry)),
  ).length;
  return matched / candidates.length;
}

function countSyllables(word: string): number {
  const clean = word.toLocaleLowerCase().replace(/[^a-z]/g, '');
  if (clean.length === 0) return 0;
  if (clean.length <= 3) return 1;
  const trimmed = clean
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch–Kincaid grade level; the prompt targets a twelve-year-old reader. */
export function readingGrade(text: string): { grade: number; words: number } {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const wordList = text.split(/\s+/).filter((word) => /[a-zA-Z]/.test(word));
  if (wordList.length === 0) return { grade: Number.NaN, words: 0 };
  const syllables = wordList.reduce((total, word) => total + countSyllables(word), 0);
  const grade =
    0.39 * (wordList.length / sentences) + 11.8 * (syllables / wordList.length) - 15.59;
  return { grade: Math.round(grade * 100) / 100, words: wordList.length };
}

/** Every string the player actually reads, tagged with where it came from. */
export function playerFacingFields(plan: AiPlan): Array<{ field: string; text: string }> {
  const fields: Array<{ field: string; text: string }> = [
    { field: 'feedback.headline', text: plan.feedback.headline },
    { field: 'feedback.advice', text: plan.feedback.advice },
    { field: 'curriculum.title', text: plan.curriculum.title },
    { field: 'curriculum.rationale', text: plan.curriculum.rationale },
    { field: 'curriculum.sessionStrategy', text: plan.curriculum.sessionStrategy },
  ];
  plan.feedback.strengths.forEach((text, index) =>
    fields.push({ field: `feedback.strengths[${index}]`, text }),
  );
  plan.feedback.weaknesses.forEach((text, index) =>
    fields.push({ field: `feedback.weaknesses[${index}]`, text }),
  );
  plan.curriculum.targetConcepts.forEach((concept, index) =>
    fields.push({ field: `curriculum.targetConcepts[${index}].reason`, text: concept.reason }),
  );
  plan.questions.forEach((question) => {
    fields.push({ field: `questions[${question.sequence}].explanation`, text: question.explanation });
    fields.push({
      field: `questions[${question.sequence}].curriculumReason`,
      text: question.curriculumReason,
    });
  });
  return fields;
}

function findTerms(
  fields: ReadonlyArray<{ field: string; text: string }>,
  terms: readonly string[],
): TermHit[] {
  const hits: TermHit[] = [];
  for (const { field, text } of fields) {
    const haystack = ` ${normalise(text)} `;
    for (const term of terms) {
      const needle = ` ${term} `;
      const at = haystack.indexOf(needle);
      if (at === -1) continue;
      hits.push({
        term,
        field,
        excerpt: text.slice(Math.max(0, at - 45), at + term.length + 45).trim(),
      });
    }
  }
  return hits;
}

/** Classifies a `findPlanIssues` string into a countable failure kind. */
export function issueKind(issue: string): string {
  if (issue.startsWith('Duplicate sequence')) return 'duplicate-sequence';
  if (issue.startsWith('Duplicate question')) return 'duplicate-stem';
  if (issue.includes('duplicate answers')) return 'duplicate-options';
  if (issue.includes('misconception must be "none"')) return 'misconception-on-correct-option';
  if (issue.includes('needs a misconception')) return 'missing-misconception-on-distractor';
  if (issue.includes('Difficulty mix must total')) return 'difficulty-mix-total';
  if (issue.includes('mix says')) return 'difficulty-mix-mismatch';
  return 'other';
}

export function measurePlan(
  plan: AiPlan,
  report: LearnerReport,
  authoredStems: ReadonlySet<string>,
): PlanMetrics {
  const semanticIssues = findPlanIssues(plan);

  const difficultyCounts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const categoryCounts: Record<string, number> = {};
  const positionCounts: [number, number, number, number] = [0, 0, 0, 0];
  let longestOptionIsCorrect = 0;
  let shortestOptionIsCorrect = 0;
  let distinctMisconceptions = 0;
  let genericMisconceptions = 0;
  let stemWords = 0;
  let novelStems = 0;

  const stemSets = plan.questions.map((question) => tokens(question.question));
  const seenStems = new Set<string>();
  let duplicateStems = 0;

  for (const [index, question] of plan.questions.entries()) {
    difficultyCounts[question.difficulty] += 1;
    categoryCounts[question.category] = (categoryCounts[question.category] ?? 0) + 1;
    positionCounts[question.correctAnswer] += 1;

    const lengths = question.answers.map((answer) => answer.trim().length);
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);
    if (lengths[question.correctAnswer] === max && lengths.filter((l) => l === max).length === 1) {
      longestOptionIsCorrect += 1;
    }
    if (lengths[question.correctAnswer] === min && lengths.filter((l) => l === min).length === 1) {
      shortestOptionIsCorrect += 1;
    }

    const distractorLabels = question.misconceptions.filter(
      (_, option) => option !== question.correctAnswer,
    );
    if (new Set(distractorLabels.map(normalise)).size === distractorLabels.length) {
      distinctMisconceptions += 1;
    }
    // A label that only restates the chosen option diagnoses nothing.
    if (distractorLabels.some((label) => /^(wrong|incorrect|confused the answer)/i.test(label.trim()))) {
      genericMisconceptions += 1;
    }

    const stem = normalise(question.question);
    if (seenStems.has(stem)) duplicateStems += 1;
    seenStems.add(stem);
    if (!authoredStems.has(stem)) novelStems += 1;
    stemWords += question.question.split(/\s+/).filter(Boolean).length;
    void index;
  }

  let nearDuplicatePairs = 0;
  for (let a = 0; a < stemSets.length; a += 1) {
    for (let b = a + 1; b < stemSets.length; b += 1) {
      if (jaccard(stemSets[a], stemSets[b]) >= 0.75) nearDuplicatePairs += 1;
    }
  }

  const expected = plan.questions.length / 4;
  const positionChiSquare = positionCounts.reduce(
    (total, observed) => total + (observed - expected) ** 2 / expected,
    0,
  );

  const targetNames = plan.curriculum.targetConcepts.map((concept) => concept.component);
  const weak = report.punchKT.weakestConcepts;
  const uncertain = report.punchKT.uncertainConcepts;
  const due = report.forgettingAware.dueConcepts;
  const needed = [...new Set([...weak, ...uncertain, ...due])];
  const misconceptionComponents = [
    ...new Set(report.misconceptionEvidence.map((entry) => entry.component)),
  ];
  const curriculumNames = [...targetNames, ...plan.curriculum.reviewConcepts];

  const fields = playerFacingFields(plan);
  const strictestFields = fields.filter((field) => !field.field.startsWith('questions['));
  const playerText = strictestFields.map((field) => field.text).join(' ');
  const reading = readingGrade(playerText);

  return {
    semanticIssues,
    issueKinds: [...new Set(semanticIssues.map(issueKind))],
    difficultyCounts,
    categoryCounts,
    categoriesUsed: Object.keys(categoryCounts).length,

    positionCounts,
    positionChiSquare: Math.round(positionChiSquare * 100) / 100,
    positionBalanced: positionChiSquare <= 7.815,
    correctAtIndex3: positionCounts[3],
    longestOptionIsCorrect,
    shortestOptionIsCorrect,
    duplicateStems,
    nearDuplicatePairs,
    meanStemWords: Math.round((stemWords / plan.questions.length) * 100) / 100,

    distinctMisconceptionRate: distinctMisconceptions / plan.questions.length,
    genericMisconceptionRate: genericMisconceptions / plan.questions.length,

    targetPrecisionStrict: ratioMatched(targetNames, needed, conceptMatchesStrict),
    targetPrecisionFuzzy: ratioMatched(targetNames, needed, conceptMatchesFuzzy),
    weakConceptRecall: ratioMatched(weak, targetNames, conceptMatchesFuzzy),
    dueConceptRecall: ratioMatched(due, curriculumNames, conceptMatchesFuzzy),
    misconceptionCoverage: ratioMatched(misconceptionComponents, curriculumNames, conceptMatchesFuzzy),
    itemsOnCurriculum:
      plan.questions.filter((question) =>
        curriculumNames.some((name) => conceptMatchesFuzzy(question.knowledgeComponent, name)),
      ).length / plan.questions.length,

    bannedHits: findTerms(strictestFields, BANNED_TERMS),
    discouragedHits: findTerms(strictestFields, DISCOURAGED_TERMS),
    readingGrade: reading.grade,
    playerWordCount: reading.words,

    novelStemRate: novelStems / plan.questions.length,
  };
}

export const normaliseStem = normalise;
