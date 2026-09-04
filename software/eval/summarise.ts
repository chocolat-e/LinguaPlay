/**
 * Phase 3 — aggregate every measurement into one summary.
 *
 * Reads runs.json (+ judge.json when present), measures each accepted plan,
 * measures the deterministic fallback planner on the identical reports as a
 * baseline, and writes results/summary.json alongside printed tables.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QUESTIONS from '../src/data/questions';
import { createLocalPlan } from '../src/adaptive/localPlanner';
import type { AiPlan, LearnerReport } from '../src/adaptive/contracts';
import { measurePlan, normaliseStem, type PlanMetrics } from './metrics';
import { RESULTS_DIR, type GenerateOutput } from './generate';
import type { JudgeOutput } from './judge';

const mean = (values: number[]): number =>
  values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};

const sd = (values: number[]): number => {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - m) ** 2, 0) / (values.length - 1));
};

/** Wilson score interval — behaves sensibly at rates near 0 and 1. */
export function wilson(successes: number, total: number): [number, number] {
  if (total === 0) return [Number.NaN, Number.NaN];
  const z = 1.959964;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ];
};

const pct = (value: number): string => (Number.isNaN(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const rate = (successes: number, total: number): string => {
  const [low, high] = wilson(successes, total);
  return `${successes}/${total} = ${pct(successes / total)} [${pct(low)}–${pct(high)}]`;
};

/** Rebuilds the fallback planner's output in the schema shape so both are measured identically. */
function localAsAiPlan(report: LearnerReport): AiPlan {
  const local = createLocalPlan(report);
  return {
    feedback: local.feedback,
    curriculum: local.curriculum,
    questions: local.questions.map((question, index) => ({
      sequence: index + 1,
      question: question.question,
      answers: question.answers,
      correctAnswer: question.correctAnswer,
      difficulty: question.difficulty,
      category: question.category,
      knowledgeComponent: question.knowledgeComponent ?? '',
      learningObjective: question.learningObjective ?? '',
      explanation: question.explanation ?? '',
      misconceptions: question.misconceptions ?? ['none', 'none', 'none', 'none'],
      curriculumReason: question.curriculumReason ?? '',
    })),
  } as AiPlan;
}

function aggregate(all: PlanMetrics[]) {
  const numeric = <K extends keyof PlanMetrics>(key: K): number[] =>
    all.map((entry) => entry[key] as number).filter((value) => !Number.isNaN(value));
  const summaryOf = (key: keyof PlanMetrics) => {
    const values = numeric(key);
    return {
      mean: Math.round(mean(values) * 10000) / 10000,
      sd: Math.round(sd(values) * 10000) / 10000,
      min: values.length ? Math.min(...values) : Number.NaN,
      max: values.length ? Math.max(...values) : Number.NaN,
      n: values.length,
    };
  };
  return {
    targetPrecisionFuzzy: summaryOf('targetPrecisionFuzzy'),
    targetPrecisionStrict: summaryOf('targetPrecisionStrict'),
    weakConceptRecall: summaryOf('weakConceptRecall'),
    dueConceptRecall: summaryOf('dueConceptRecall'),
    misconceptionCoverage: summaryOf('misconceptionCoverage'),
    itemsOnCurriculum: summaryOf('itemsOnCurriculum'),
    novelStemRate: summaryOf('novelStemRate'),
    readingGrade: summaryOf('readingGrade'),
    categoriesUsed: summaryOf('categoriesUsed'),
    distinctMisconceptionRate: summaryOf('distinctMisconceptionRate'),
    genericMisconceptionRate: summaryOf('genericMisconceptionRate'),
    positionChiSquare: summaryOf('positionChiSquare'),
    correctAtIndex3: summaryOf('correctAtIndex3'),
    longestOptionIsCorrect: summaryOf('longestOptionIsCorrect'),
    nearDuplicatePairs: summaryOf('nearDuplicatePairs'),
    meanStemWords: summaryOf('meanStemWords'),
    positionBalancedPlans: all.filter((entry) => entry.positionBalanced).length,
    plansWithBannedTerm: all.filter((entry) => entry.bannedHits.length > 0).length,
    plansWithDiscouragedTerm: all.filter((entry) => entry.discouragedHits.length > 0).length,
    bannedTermHits: all.flatMap((entry) => entry.bannedHits),
    discouragedTermHits: all.flatMap((entry) => entry.discouragedHits),
    plans: all.length,
  };
}

/**
 * Measures the deterministic fallback planner alone, across every profile.
 * Needs no API access, so the baseline column of the report can be produced
 * (and re-checked) independently of the coach.
 */
export async function baseline(repeats: number, log: (line: string) => void) {
  const { buildPersonaCases } = await import('./personas');
  const cases = buildPersonaCases(repeats, Date.UTC(2026, 8, 2, 9, 0, 0));
  const authoredStems = new Set(QUESTIONS.map((question) => normaliseStem(question.question)));
  const measured = cases.map((entry) => ({
    personaId: entry.spec.id,
    metrics: measurePlan(localAsAiPlan(entry.report), entry.report, authoredStems),
  }));
  const agg = aggregate(measured.map((entry) => entry.metrics));

  log('');
  log('=== DETERMINISTIC FALLBACK PLANNER (baseline, no API) ==============');
  log(`plans measured              ${agg.plans}`);
  const show = (label: string, value: { mean: number; sd: number }) =>
    log(`${label.padEnd(30)} ${String(value.mean).padStart(8)} (sd ${value.sd})`);
  show('target precision (fuzzy)', agg.targetPrecisionFuzzy);
  show('target precision (strict)', agg.targetPrecisionStrict);
  show('weak-concept recall', agg.weakConceptRecall);
  show('due-concept recall', agg.dueConceptRecall);
  show('misconception coverage', agg.misconceptionCoverage);
  show('items on curriculum', agg.itemsOnCurriculum);
  show('novel stems (vs bank)', agg.novelStemRate);
  show('categories used (of 6)', agg.categoriesUsed);
  show('distinct misconceptions', agg.distinctMisconceptionRate);
  show('generic misconceptions', agg.genericMisconceptionRate);
  show('reading grade (FK)', agg.readingGrade);
  show('correct at index 3', agg.correctAtIndex3);
  show('longest option is correct', agg.longestOptionIsCorrect);
  log(`position balanced (chi2)       ${agg.positionBalancedPlans}/${agg.plans} plans`);
  log(`plans leaking banned terms     ${agg.plansWithBannedTerm}/${agg.plans}`);
  log(`semantic issues               ${measured.filter((m) => m.metrics.semanticIssues.length > 0).length}/${agg.plans} plans`);
  for (const hit of agg.bannedTermHits.slice(0, 10)) {
    log(`  [${hit.term}] ${hit.field}: ${hit.excerpt}`);
  }
  writeFileSync(
    join(RESULTS_DIR, 'baseline.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), repeats, aggregate: agg, perPlan: measured }, null, 2),
    'utf8',
  );
  log(`wrote ${join(RESULTS_DIR, 'baseline.json')}`);
  return agg;
}

export async function summarise(log: (line: string) => void) {
  const generated = JSON.parse(
    readFileSync(join(RESULTS_DIR, 'runs.json'), 'utf8'),
  ) as GenerateOutput;
  const judgePath = join(RESULTS_DIR, 'judge.json');
  const judged: JudgeOutput | null = existsSync(judgePath)
    ? (JSON.parse(readFileSync(judgePath, 'utf8')) as JudgeOutput)
    : null;

  const reportById = new Map(
    generated.reports.map((entry) => [entry.runId, entry.report as LearnerReport]),
  );
  const authoredStems = new Set(QUESTIONS.map((question) => normaliseStem(question.question)));

  /* ------------------------------------------------ reliability ---------- */
  const runs = generated.runs;
  const firstAttempts = runs.map((run) => run.attempts[0]).filter(Boolean);
  const served = runs.filter((run) => run.served);
  const neededRetry = runs.filter((run) => run.acceptedOnAttempt === 2);
  const retryCandidates = runs.filter((run) => run.attempts.length > 1);
  const allAttempts = runs.flatMap((run) => run.attempts);

  const issueKindCounts = new Map<string, number>();
  for (const attempt of allAttempts) {
    for (const kind of attempt.issueKinds) {
      issueKindCounts.set(kind, (issueKindCounts.get(kind) ?? 0) + 1);
    }
  }

  const costs = allAttempts.map((a) => a.costUsd ?? 0);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const latencies = allAttempts.map((a) => a.latencyMs / 1000);
  const completionTokens = allAttempts.map((a) => a.completionTokens ?? 0).filter(Boolean);
  const promptTokens = allAttempts.map((a) => a.promptTokens ?? 0).filter(Boolean);
  const reasoningTokens = allAttempts.map((a) => a.reasoningTokens ?? 0).filter((v) => v > 0);

  const reliability = {
    runs: runs.length,
    httpOk: allAttempts.filter((a) => a.httpOk).length,
    attempts: allAttempts.length,
    schemaValidAttempts: allAttempts.filter((a) => a.schemaValid).length,
    firstAttemptAccepted: firstAttempts.filter((a) => a.accepted).length,
    firstAttemptSchemaValid: firstAttempts.filter((a) => a.schemaValid).length,
    retryRecovered: neededRetry.length,
    retryAttempted: retryCandidates.length,
    served: served.length,
    fallback: runs.length - served.length,
    issueKindCounts: Object.fromEntries(issueKindCounts),
    latencySeconds: {
      mean: Math.round(mean(latencies) * 100) / 100,
      p50: Math.round(quantile(latencies, 0.5) * 100) / 100,
      p95: Math.round(quantile(latencies, 0.95) * 100) / 100,
      max: Math.round(Math.max(...latencies) * 100) / 100,
    },
    endToEndSeconds: {
      mean: Math.round(mean(runs.map((r) => r.totalLatencyMs / 1000)) * 100) / 100,
      p95: Math.round(quantile(runs.map((r) => r.totalLatencyMs / 1000), 0.95) * 100) / 100,
    },
    tokens: {
      promptMean: Math.round(mean(promptTokens)),
      completionMean: Math.round(mean(completionTokens)),
      reasoningMean: reasoningTokens.length ? Math.round(mean(reasoningTokens)) : null,
    },
    costUsd: { total: totalCost, perAttempt: totalCost / allAttempts.length, perServedPlan: totalCost / Math.max(1, served.length) },
  };

  /* ------------------------------------------------ plan quality --------- */
  const llmMetrics: Array<{ runId: string; personaId: string; metrics: PlanMetrics }> = [];
  const localMetrics: Array<{ runId: string; personaId: string; metrics: PlanMetrics }> = [];
  for (const run of runs) {
    const report = reportById.get(run.runId);
    if (!report) continue;
    if (run.plan) {
      llmMetrics.push({
        runId: run.runId,
        personaId: run.personaId,
        metrics: measurePlan(run.plan, report, authoredStems),
      });
    }
    localMetrics.push({
      runId: run.runId,
      personaId: run.personaId,
      metrics: measurePlan(localAsAiPlan(report), report, authoredStems),
    });
  }

  const llm = aggregate(llmMetrics.map((entry) => entry.metrics));
  const local = aggregate(localMetrics.map((entry) => entry.metrics));

  /* ---- cross-run item overlap: does each session get a fresh pool? ------- */
  const stemsByRun = llmMetrics.map((entry) => entry.runId);
  const planStems = new Map<string, Set<string>>();
  for (const run of runs) {
    if (!run.plan) continue;
    planStems.set(run.runId, new Set(run.plan.questions.map((q) => normaliseStem(q.question))));
  }
  const overlaps: number[] = [];
  const runIds = [...planStems.keys()];
  for (let a = 0; a < runIds.length; a += 1) {
    for (let b = a + 1; b < runIds.length; b += 1) {
      const left = planStems.get(runIds[a])!;
      const right = planStems.get(runIds[b])!;
      let shared = 0;
      for (const stem of left) if (right.has(stem)) shared += 1;
      overlaps.push(shared / left.size);
    }
  }
  const uniqueStemsOverall = new Set([...planStems.values()].flatMap((set) => [...set]));
  const totalStems = [...planStems.values()].reduce((total, set) => total + set.size, 0);
  void stemsByRun;

  /* ------------------------------------------------ judge ---------------- */
  let judgeSummary: Record<string, unknown> | null = null;
  if (judged) {
    const llmItems = judged.items.filter((item) => item.source === 'llm');
    const authoredItems = judged.items.filter((item) => item.source === 'authored');
    const byDifficulty = (items: typeof llmItems, difficulty: string) =>
      items.filter((item) => item.difficulty === difficulty);
    judgeSummary = {
      solverModel: judged.solverModel,
      costUsd: judged.costUsd,
      failures: judged.failures,
      llm: {
        total: llmItems.length,
        agreed: llmItems.filter((item) => item.agreed).length,
        concerns: llmItems.filter((item) => item.concern !== 'none').length,
        byDifficulty: Object.fromEntries(
          ['easy', 'medium', 'hard'].map((difficulty) => {
            const subset = byDifficulty(llmItems, difficulty);
            return [difficulty, { total: subset.length, agreed: subset.filter((i) => i.agreed).length }];
          }),
        ),
        concernKinds: llmItems.reduce<Record<string, number>>((counts, item) => {
          counts[item.concern] = (counts[item.concern] ?? 0) + 1;
          return counts;
        }, {}),
      },
      authoredControl: {
        total: authoredItems.length,
        agreed: authoredItems.filter((item) => item.agreed).length,
        concerns: authoredItems.filter((item) => item.concern !== 'none').length,
      },
    };
  }

  /* ------------------------------------------------ per-persona ---------- */
  const personaIds = [...new Set(runs.map((run) => run.personaId))];
  const perPersona = personaIds.map((personaId) => {
    const mine = runs.filter((run) => run.personaId === personaId);
    const metrics = llmMetrics.filter((entry) => entry.personaId === personaId).map((e) => e.metrics);
    return {
      personaId,
      runs: mine.length,
      served: mine.filter((run) => run.served).length,
      firstAttemptAccepted: mine.filter((run) => run.acceptedOnAttempt === 1).length,
      targetPrecisionFuzzy: Math.round(mean(metrics.map((m) => m.targetPrecisionFuzzy)) * 1000) / 1000,
      weakConceptRecall: Math.round(mean(metrics.map((m) => m.weakConceptRecall)) * 1000) / 1000,
      dueConceptRecall: Math.round(mean(metrics.map((m) => m.dueConceptRecall)) * 1000) / 1000,
      itemsOnCurriculum: Math.round(mean(metrics.map((m) => m.itemsOnCurriculum)) * 1000) / 1000,
      readingGrade: Math.round(mean(metrics.map((m) => m.readingGrade)) * 100) / 100,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    model: generated.model,
    repeats: generated.repeats,
    reliability,
    llm,
    local,
    novelty: {
      meanPairwiseOverlap: Math.round(mean(overlaps) * 10000) / 10000,
      maxPairwiseOverlap: overlaps.length ? Math.round(Math.max(...overlaps) * 10000) / 10000 : Number.NaN,
      uniqueStemsAcrossAllPlans: uniqueStemsOverall.size,
      totalStemsGenerated: totalStems,
    },
    judge: judgeSummary,
    perPersona,
    perRun: llmMetrics.map((entry) => ({ runId: entry.runId, personaId: entry.personaId, ...entry.metrics })),
  };

  writeFileSync(join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  /* ------------------------------------------------ printed tables ------- */
  log('');
  log('=== RELIABILITY ===================================================');
  log(`runs                        ${reliability.runs}   model ${generated.model}`);
  log(`schema-valid attempts       ${rate(reliability.schemaValidAttempts, reliability.attempts)}`);
  log(`accepted on first attempt   ${rate(reliability.firstAttemptAccepted, reliability.runs)}`);
  log(`recovered by the retry      ${reliability.retryRecovered}/${reliability.retryAttempted} retries`);
  log(`plan served (no fallback)   ${rate(reliability.served, reliability.runs)}`);
  log(`failure kinds               ${JSON.stringify(reliability.issueKindCounts)}`);
  log(`latency s  mean/p50/p95/max ${reliability.latencySeconds.mean} / ${reliability.latencySeconds.p50} / ${reliability.latencySeconds.p95} / ${reliability.latencySeconds.max}`);
  log(`end-to-end s  mean/p95      ${reliability.endToEndSeconds.mean} / ${reliability.endToEndSeconds.p95}`);
  log(`tokens in/out/reasoning     ${reliability.tokens.promptMean} / ${reliability.tokens.completionMean} / ${reliability.tokens.reasoningMean ?? 'n/a'}`);
  log(`cost total / per served     $${reliability.costUsd.total.toFixed(4)} / $${reliability.costUsd.perServedPlan.toFixed(4)}`);

  log('');
  log('=== PLAN QUALITY (LLM vs deterministic fallback) ==================');
  const row = (label: string, a: { mean: number; sd: number }, b: { mean: number; sd: number }) =>
    log(`${label.padEnd(30)} ${String(a.mean).padStart(8)} (sd ${String(a.sd).padStart(7)})   ${String(b.mean).padStart(8)} (sd ${String(b.sd).padStart(7)})`);
  log(`${''.padEnd(30)} ${'LLM'.padStart(8)}                  ${'LOCAL'.padStart(8)}`);
  row('target precision (fuzzy)', llm.targetPrecisionFuzzy, local.targetPrecisionFuzzy);
  row('target precision (strict)', llm.targetPrecisionStrict, local.targetPrecisionStrict);
  row('weak-concept recall', llm.weakConceptRecall, local.weakConceptRecall);
  row('due-concept recall', llm.dueConceptRecall, local.dueConceptRecall);
  row('misconception coverage', llm.misconceptionCoverage, local.misconceptionCoverage);
  row('items on curriculum', llm.itemsOnCurriculum, local.itemsOnCurriculum);
  row('novel stems (vs bank)', llm.novelStemRate, local.novelStemRate);
  row('categories used (of 6)', llm.categoriesUsed, local.categoriesUsed);
  row('distinct misconceptions', llm.distinctMisconceptionRate, local.distinctMisconceptionRate);
  row('generic misconceptions', llm.genericMisconceptionRate, local.genericMisconceptionRate);
  row('reading grade (FK)', llm.readingGrade, local.readingGrade);
  row('near-duplicate pairs', llm.nearDuplicatePairs, local.nearDuplicatePairs);
  row('correct at index 3', llm.correctAtIndex3, local.correctAtIndex3);
  row('longest option is correct', llm.longestOptionIsCorrect, local.longestOptionIsCorrect);
  log(`position balanced (chi2)       ${llm.positionBalancedPlans}/${llm.plans} plans        ${local.positionBalancedPlans}/${local.plans} plans`);
  log(`plans leaking banned terms     ${llm.plansWithBannedTerm}/${llm.plans}              ${local.plansWithBannedTerm}/${local.plans}`);
  log(`plans using "concept"          ${llm.plansWithDiscouragedTerm}/${llm.plans}              ${local.plansWithDiscouragedTerm}/${local.plans}`);

  if (llm.bannedTermHits.length > 0) {
    log('');
    log('--- banned-term hits (verify each by hand) ---');
    for (const hit of llm.bannedTermHits.slice(0, 40)) {
      log(`  [${hit.term}] ${hit.field}: ${hit.excerpt}`);
    }
  }

  log('');
  log('=== NOVELTY =======================================================');
  log(`mean pairwise stem overlap  ${pct(summary.novelty.meanPairwiseOverlap)}`);
  log(`max pairwise stem overlap   ${pct(summary.novelty.maxPairwiseOverlap)}`);
  log(`unique stems / generated    ${summary.novelty.uniqueStemsAcrossAllPlans} / ${summary.novelty.totalStemsGenerated}`);

  if (judgeSummary) {
    const j = judgeSummary as any;
    log('');
    log('=== INDEPENDENT SOLVER ============================================');
    log(`solver                      ${j.solverModel}`);
    log(`LLM items agreed            ${rate(j.llm.agreed, j.llm.total)}`);
    log(`authored control agreed     ${rate(j.authoredControl.agreed, j.authoredControl.total)}`);
    log(`agreement by difficulty     ${['easy', 'medium', 'hard'].map((d) => `${d} ${j.llm.byDifficulty[d].agreed}/${j.llm.byDifficulty[d].total}`).join('  ')}`);
    log(`solver concerns raised      ${JSON.stringify(j.llm.concernKinds)}`);
  }

  log('');
  log('=== PER PROFILE ===================================================');
  log('profile                        served  1st  targetP  weakR  dueR  onCurr  grade');
  for (const persona of perPersona) {
    log(
      [
        persona.personaId.padEnd(28),
        String(`${persona.served}/${persona.runs}`).padStart(6),
        String(persona.firstAttemptAccepted).padStart(4),
        String(persona.targetPrecisionFuzzy).padStart(8),
        String(persona.weakConceptRecall).padStart(6),
        String(persona.dueConceptRecall).padStart(5),
        String(persona.itemsOnCurriculum).padStart(7),
        String(persona.readingGrade).padStart(6),
      ].join(' '),
    );
  }
  log('');
  log(`wrote ${join(RESULTS_DIR, 'summary.json')}`);
  return summary;
}
