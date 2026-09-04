/**
 * Phase 4 — render results/summary.json as a standalone HTML report.
 *
 * Every figure in the report is read from the harness output at build time, so
 * the document cannot drift from the measurements it describes: re-run the
 * phases, re-run this, and the report restates whatever the new run measured.
 *
 *   node eval/report.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(EVAL_DIR, 'results');

const readJson = (name) => JSON.parse(readFileSync(join(RESULTS_DIR, name), 'utf8'));

const summary = readJson('summary.json');
const baseline = existsSync(join(RESULTS_DIR, 'baseline.json')) ? readJson('baseline.json') : null;

/** Wilson score interval — same estimator the summariser prints. */
function wilson(successes, total) {
  if (!total) return [NaN, NaN];
  const z = 1.959964;
  const p = successes / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Mean count of the correct answer landing at each of the four option slots. */
function positionProfile(rows) {
  const counts = rows.map((r) => r.positionCounts).filter(Boolean);
  return [0, 1, 2, 3].map((i) => mean(counts.map((c) => c[i])));
}

const llmPerRun = summary.perRun ?? [];
const localPerPlan = (baseline?.perPlan ?? []).map((entry) => entry.metrics);

const view = {
  generatedAt: summary.generatedAt,
  model: summary.model,
  repeats: summary.repeats,
  reliability: summary.reliability,
  llm: summary.llm,
  local: summary.local ?? baseline?.aggregate ?? null,
  novelty: summary.novelty,
  judge: summary.judge,
  perPersona: summary.perPersona,
  positions: {
    llm: positionProfile(llmPerRun),
    local: positionProfile(localPerPlan),
    expected: 30 / 4,
  },
  wilson: {
    served: wilson(summary.reliability.served, summary.reliability.runs),
    firstAttempt: wilson(summary.reliability.firstAttemptAccepted, summary.reliability.runs),
    schemaValid: wilson(summary.reliability.schemaValidAttempts, summary.reliability.attempts),
    judgeLlm: summary.judge ? wilson(summary.judge.llm.agreed, summary.judge.llm.total) : null,
    judgeAuthored: summary.judge
      ? wilson(summary.judge.authoredControl.agreed, summary.judge.authoredControl.total)
      : null,
  },
};

const template = readFileSync(join(EVAL_DIR, 'report.template.html'), 'utf8');
const html = template.replace('/*__DATA__*/null', JSON.stringify(view));
const out = join(RESULTS_DIR, 'report.html');
writeFileSync(out, html, 'utf8');
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
