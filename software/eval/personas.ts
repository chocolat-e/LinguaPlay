/**
 * Learner profiles for the coach evaluation.
 *
 * Nothing here hand-writes a `LearnerReport`. Each profile describes how a kind
 * of player behaves, a seeded simulation plays sessions for them, and the
 * shipped `PunchKTLearner` turns that history into the report — so the coach is
 * measured on exactly the input the live game sends it.
 */
import QUESTIONS from '../src/data/questions';
import { knowledgeComponentFor, misconceptionFor } from '../src/adaptive/questionProfile';
import { PunchKTLearner } from '../src/adaptive/PunchKTLearner';
import type { LearnerReport } from '../src/adaptive/contracts';
import type {
  AnswerRecord,
  Category,
  Difficulty,
  HitQuality,
  Question,
  SessionStats,
} from '../src/game/types';

const HOUR_MS = 60 * 60 * 1000;
const LANDED_QUALITIES: HitQuality[] = ['PERFECT', 'GREAT', 'GOOD'];

export interface PersonaSpec {
  id: string;
  /** Short name used in the report tables. */
  label: string;
  /** What this profile is meant to probe. */
  probe: string;
  priorSessions: number;
  hoursSinceLastSession: number;
  questionsPerSession: number;
  baseAccuracy: number;
  accuracyByCategory?: Partial<Record<Category, number>>;
  /** Components the player reliably fails, to create a stable weak spot. */
  stickyWrongComponents?: string[];
  missRate: number;
  earlyRate: number;
  reactionRange: [number, number];
  difficulty: Difficulty;
}

/**
 * Eight profiles spanning the states the planner has to handle: a cold start, a
 * struggling player, a strong one, a player whose problem is motor rather than
 * linguistic, and a returning player whose knowledge has decayed.
 */
export const PERSONAS: PersonaSpec[] = [
  {
    id: 'P1-cold-start',
    label: 'Cold start (diagnostic round)',
    probe: 'First session, sparse evidence, no misconception history.',
    priorSessions: 0,
    hoursSinceLastSession: 0,
    questionsPerSession: 20,
    baseAccuracy: 0.55,
    missRate: 0.1,
    earlyRate: 0.15,
    reactionRange: [1.6, 3.4],
    difficulty: 'easy',
  },
  {
    id: 'P2-struggling-beginner',
    label: 'Struggling beginner',
    probe: 'Low accuracy across the board; many weak concepts compete for the pool.',
    priorSessions: 2,
    hoursSinceLastSession: 6,
    questionsPerSession: 20,
    baseAccuracy: 0.34,
    accuracyByCategory: { grammar: 0.22, sentence: 0.25 },
    missRate: 0.12,
    earlyRate: 0.2,
    reactionRange: [2.2, 4.2],
    difficulty: 'easy',
  },
  {
    id: 'P3-grammar-gaps',
    label: 'Strong vocabulary, weak grammar',
    probe: 'Uneven profile: the plan should target grammar, not vocabulary.',
    priorSessions: 2,
    hoursSinceLastSession: 8,
    questionsPerSession: 20,
    baseAccuracy: 0.78,
    accuracyByCategory: { grammar: 0.28, sentence: 0.35 },
    stickyWrongComponents: ['first-conditional', 'third-conditional-inversion', 'past-simple-passive'],
    missRate: 0.08,
    earlyRate: 0.12,
    reactionRange: [1.4, 2.8],
    difficulty: 'medium',
  },
  {
    id: 'P4-advanced',
    label: 'Advanced learner',
    probe: 'Few weaknesses; the plan must still stretch rather than repeat easy work.',
    priorSessions: 3,
    hoursSinceLastSession: 5,
    questionsPerSession: 20,
    baseAccuracy: 0.88,
    accuracyByCategory: { vocabulary: 0.92, synonym: 0.9 },
    missRate: 0.05,
    earlyRate: 0.08,
    reactionRange: [1.1, 2.2],
    difficulty: 'hard',
  },
  {
    id: 'P5-motor-misses',
    label: 'High miss rate (motor, not language)',
    probe: 'Most questions time out. Misses must not be reported as English errors.',
    priorSessions: 1,
    hoursSinceLastSession: 4,
    questionsPerSession: 20,
    baseAccuracy: 0.72,
    missRate: 0.45,
    earlyRate: 0.1,
    reactionRange: [2.8, 4.6],
    difficulty: 'medium',
  },
  {
    id: 'P6-early-puncher',
    label: 'Early puncher',
    probe: 'Answers land before the options are read; advice should address timing.',
    priorSessions: 1,
    hoursSinceLastSession: 3,
    questionsPerSession: 20,
    baseAccuracy: 0.48,
    missRate: 0.08,
    earlyRate: 0.62,
    reactionRange: [0.6, 1.4],
    difficulty: 'medium',
  },
  {
    id: 'P7-returning-decayed',
    label: 'Returning after a long break',
    probe: 'Retention has decayed; review concepts should surface in the plan.',
    priorSessions: 3,
    hoursSinceLastSession: 340,
    questionsPerSession: 20,
    baseAccuracy: 0.62,
    missRate: 0.1,
    earlyRate: 0.14,
    reactionRange: [1.8, 3.6],
    difficulty: 'medium',
  },
  {
    id: 'P8-repeated-misconception',
    label: 'Repeated misconception',
    probe: 'The same wrong option chosen session after session; the plan should name it.',
    priorSessions: 3,
    hoursSinceLastSession: 7,
    questionsPerSession: 20,
    baseAccuracy: 0.7,
    stickyWrongComponents: ['present-simple-third-person', 'present-perfect-since', 'ie-ei-spelling'],
    missRate: 0.09,
    earlyRate: 0.13,
    reactionRange: [1.5, 3.0],
    difficulty: 'medium',
  },
];

/** Deterministic PRNG so a report run can be reproduced exactly from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function accuracyFor(spec: PersonaSpec, question: Question, component: string): number {
  if (spec.stickyWrongComponents?.includes(component)) return 0.12;
  return spec.accuracyByCategory?.[question.category] ?? spec.baseAccuracy;
}

function playSession(
  spec: PersonaSpec,
  random: () => number,
  sessionStartMs: number,
): AnswerRecord[] {
  const order = shuffled(QUESTIONS, random);
  const records: AnswerRecord[] = [];

  for (let index = 0; index < spec.questionsPerSession; index += 1) {
    const question = order[index % order.length];
    const component = knowledgeComponentFor(question);
    const reaction =
      spec.reactionRange[0] + random() * (spec.reactionRange[1] - spec.reactionRange[0]);
    const recordedAt = sessionStartMs + index * 9_000;

    if (random() < spec.missRate) {
      records.push({
        questionId: question.id,
        difficulty: question.difficulty,
        category: question.category,
        outcome: 'MISS',
        reactionTime: reaction,
        quality: null,
        selectedAnswer: null,
        correctAnswer: question.correctAnswer,
        selectedText: null,
        correctText: question.answers[question.correctAnswer],
        knowledgeComponent: component,
        misconception: null,
        recordedAt,
      });
      continue;
    }

    const quality: HitQuality =
      random() < spec.earlyRate
        ? 'EARLY'
        : LANDED_QUALITIES[Math.floor(random() * LANDED_QUALITIES.length)];
    const correct = random() < accuracyFor(spec, question, component);
    // The game serves three of the four authored options, so a wrong punch can
    // only ever land on one of the first three lanes.
    const wrongOptions = [0, 1, 2].filter((option) => option !== question.correctAnswer);
    const selectedAnswer = correct
      ? question.correctAnswer
      : wrongOptions[Math.floor(random() * wrongOptions.length)];

    records.push({
      questionId: question.id,
      difficulty: question.difficulty,
      category: question.category,
      outcome: correct ? 'CORRECT' : 'WRONG',
      reactionTime: reaction,
      quality,
      selectedAnswer,
      correctAnswer: question.correctAnswer,
      selectedText: question.answers[selectedAnswer],
      correctText: question.answers[question.correctAnswer],
      knowledgeComponent: component,
      misconception: misconceptionFor(question, selectedAnswer),
      recordedAt,
    });
  }

  return records;
}

function statsFor(records: readonly AnswerRecord[], spec: PersonaSpec): SessionStats {
  const correct = records.filter((entry) => entry.outcome === 'CORRECT').length;
  const wrong = records.filter((entry) => entry.outcome === 'WRONG').length;
  const missed = records.filter((entry) => entry.outcome === 'MISS').length;
  const answered = correct + wrong;
  const landed = records.filter((entry) => entry.outcome !== 'MISS');
  const averageReaction =
    landed.length === 0
      ? 0
      : landed.reduce((total, entry) => total + entry.reactionTime, 0) / landed.length;

  return {
    score: correct * 120,
    combo: 0,
    bestCombo: Math.max(1, Math.round(correct / 2)),
    multiplier: 1,
    correct,
    wrong,
    missed,
    answered,
    totalQuestions: records.length,
    accuracy: answered === 0 ? 0 : correct / answered,
    averageReaction,
    difficulty: spec.difficulty,
  };
}

export interface PersonaCase {
  spec: PersonaSpec;
  seed: number;
  report: LearnerReport;
}

/** Builds one report by replaying `priorSessions` history and then a live round. */
export function buildPersonaReport(spec: PersonaSpec, seed: number, now: number): LearnerReport {
  const random = mulberry32(seed);
  const learner = new PunchKTLearner();

  for (let session = spec.priorSessions; session >= 1; session -= 1) {
    // Older sessions sit further back in time so retention can decay between them.
    const startMs = now - (spec.hoursSinceLastSession + session * 26) * HOUR_MS;
    for (const record of playSession(spec, random, startMs)) learner.record(record);
    learner.completeSession();
  }

  const currentStart = now - spec.hoursSinceLastSession * HOUR_MS;
  const history = playSession(spec, random, currentStart);
  for (const record of history) learner.record(record);

  return learner.buildReport(history, statsFor(history, spec), now);
}

/** `repeats` reports per profile, each with its own seed. */
export function buildPersonaCases(repeats: number, now: number): PersonaCase[] {
  const cases: PersonaCase[] = [];
  PERSONAS.forEach((spec, personaIndex) => {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const seed = 1000 + personaIndex * 97 + repeat * 7919;
      cases.push({ spec, seed, report: buildPersonaReport(spec, seed, now) });
    }
  });
  return cases;
}
