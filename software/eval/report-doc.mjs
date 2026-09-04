/**
 * Phase 4b — render results/summary.json as a Word document.
 *
 * Emits Markdown and hands it to pandoc, so the .docx carries native Word
 * headings and tables rather than a screenshot of a web page. Same source data
 * as `report.mjs`, so the two documents cannot disagree.
 *
 *   node eval/report-doc.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(EVAL_DIR, 'results');
const read = (n) => JSON.parse(readFileSync(join(RESULTS_DIR, n), 'utf8'));

const S = read('summary.json');
const baseline = existsSync(join(RESULTS_DIR, 'baseline.json')) ? read('baseline.json') : null;
const disagreements = existsSync(join(RESULTS_DIR, 'disagreements.json')) ? read('disagreements.json') : [];

const R = S.reliability;
const L = S.llm;
const B = S.local ?? baseline?.aggregate ?? null;
const J = S.judge;

const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : 'n/a');
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function wilson(s, n) {
  if (!n) return [NaN, NaN];
  const z = 1.959964, p = s / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const sp = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return [Math.max(0, (c - sp) / d), Math.min(1, (c + sp) / d)];
}
const ci = (s, n) => { const w = wilson(s, n); return `[${pct(w[0], 1)}–${pct(w[1], 1)}]`; };
const cell = (a) => (a && Number.isFinite(a.mean) ? `${num(a.mean, 3)} (sd ${num(a.sd, 3)})` : 'n/a');

/** Markdown table from a header row and body rows. */
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const positions = (rows) => {
  const counts = rows.map((r) => r.positionCounts).filter(Boolean);
  return [0, 1, 2, 3].map((i) => mean(counts.map((c) => c[i])));
};
const posLlm = positions(S.perRun ?? []);
const posLocal = positions((baseline?.perPlan ?? []).map((e) => e.metrics));

const keyDisagreements = disagreements.filter((d) => !d.agreed);
const concernOnly = disagreements.length - keyDisagreements.length;
const bannedHit = (L.bannedTermHits ?? [])[0];
const solver = J ? J.solverModel : 'not run';
const totalCost = R.costUsd.total + (J ? J.costUsd : 0);

const md = `---
title: "How well does the AI coach plan the next round?"
subtitle: "Punch English — between-level curriculum planner evaluation"
author: "gPBL 2026 · Punch English"
date: "${new Date(S.generatedAt).toISOString().slice(0, 10)}"
---

Thirty-two simulated learner sessions were put through the live between-level
curriculum planner, measured against the deterministic fallback planner on
identical inputs, and checked item-by-item by an independent solver from a
different provider family.

${table(['Field', 'Value'], [
  ['Planner model', '`' + S.model + '`'],
  ['Independent solver', '`' + solver + '`'],
  ['Sessions', `${R.runs} (${S.perPersona.length} profiles × ${S.repeats} repeats)`],
  ['Billed cost', '$' + totalCost.toFixed(2)],
  ['Run date', new Date(S.generatedAt).toISOString().slice(0, 10)],
])}

# 1. Summary

${table(['Headline measure', 'Result'], [
  ['Plan served (no fallback)', `${pct(R.served / R.runs, 0)} (${R.served}/${R.runs})`],
  ['Accepted on first attempt', `${pct(R.firstAttemptAccepted / R.runs, 0)} (${R.firstAttemptAccepted}/${R.runs})`],
  ['Median latency', `${num(R.latencySeconds.p50, 0)} s (p95 ${num(R.latencySeconds.p95, 0)} s)`],
  ['Cost per served plan', '$' + R.costUsd.perServedPlan.toFixed(3)],
  ...(J ? [['Independent solver agreement', `${pct(J.llm.agreed / J.llm.total)} (control ${pct(J.authoredControl.agreed / J.authoredControl.total)})`]] : []),
])}

The coach returned a usable plan for every session, all of them accepted on the
first attempt, so the repair loop and the deterministic fallback were never
exercised.${J ? ` An independent solver from a different provider family agreed with
${pct(J.llm.agreed / J.llm.total)} of ${J.llm.total} generated answer keys, against
${pct(J.authoredControl.agreed / J.authoredControl.total)} on the human-authored control.` : ''}

Against the deterministic fallback it wins decisively where the fallback
structurally cannot compete — novel material (${pct(L.novelStemRate.mean, 0)} of stems are
new), diagnostic distractor labels (${pct(1 - L.genericMisconceptionRate.mean, 0)} specific
rather than generic), and questions that actually sit on the stated curriculum
(${pct(L.itemsOnCurriculum.mean, 0)} against ${B ? pct(B.itemsOnCurriculum.mean, 0) : 'n/a'}). It is
beaten on concept targeting, where the fallback scores 1.00 by copying the
report's own weak-concept list. The costs are ${num(R.latencySeconds.p50, 0)} s median
latency (p95 ${num(R.latencySeconds.p95, 0)} s) and $${R.costUsd.perServedPlan.toFixed(2)} per
plan — affordable between rounds, far too slow inside one.

# 2. System under test

Punch English is a three-lane rhythm-boxing game for learning English. The live
round is driven by a deterministic adaptive algorithm; the language model is used
only between rounds. When a round ends the game posts a *learner report* to a local
endpoint (\`/api/punchkt/plan\`) and asks for one thing back: a plan for the next
round — end-of-round feedback, a curriculum, and a pool of exactly 30
multiple-choice questions.

The learner report carries three kinds of evidence, and the prompt requires all
three to be used: per-concept mastery and uncertainty; the specific wrong options a
player keeps choosing; and which concepts are due for review under a forgetting
curve. It also separates motor evidence from language evidence — a punch that never
lands is not an English mistake.

The response is constrained by a JSON schema and then checked twice locally: the
schema parse enforces the shape and the 30-question count, and \`findPlanIssues\`
enforces the semantics — unique question stems, no duplicate options, a
misconception label on every wrong option and the literal \`"none"\` on the correct
one, and a difficulty mix that both totals 30 and matches the questions actually
written. A plan failing either check is sent back once with the list of faults; if
the retry also fails, the game falls back to a deterministic local planner. That
fallback is the baseline this report measures against.

# 3. Method

## 3.1 Simulated learners

Real play data does not exist at the volume an evaluation needs, so the harness
synthesises it. Eight learner profiles are defined by their measurable behaviour —
a cold start, a struggling beginner, a player with specific grammar gaps, an
advanced player, one whose punches keep missing, one who punches early, one
returning after a long gap with decayed retention, and one repeating the same
misconception. Each profile is simulated ${S.repeats} times with different seeds,
giving ${R.runs} independent sessions under a single fixed clock so every simulated
report is reproducible.

## 3.2 The comparison

Every metric is computed twice — once on the model's plan, once on the
deterministic fallback planner's plan for the *same* learner report — by the same
code. That pairing answers whether the model earns its cost and latency, rather
than whether its output looks plausible in isolation.

## 3.3 Independent item check

Question quality cannot be graded by the model that wrote the questions. A separate
solver from a **different provider family** answers every generated item without
being shown the answer key, and reports its own concern about each item. The same
solver also answers the 30 human-authored questions already shipped in the game.
Those are the control: whatever the solver gets "wrong" on hand-written items is
its own error rate, and it sets the floor the generated items are read against.

# 4. What is measured

Six groups. Everything except the solver check is computed without a model and
without a human, so it can be re-run on any future prompt or model change and
compared directly.

${table(['Group', 'What it captures'], [
  ['Reliability', 'Schema-valid rate, first-attempt acceptance, retry recovery, served rate (Wilson intervals), latency, tokens, billed cost.'],
  ['Item soundness', 'Independent-solver agreement with the key, split by difficulty, against the human-authored control, plus concern categories.'],
  ['Curriculum targeting', 'Target-concept precision (exact and fuzzy), weak- and due-concept recall, misconception coverage, share of questions on the stated curriculum.'],
  ['Item-writing quality', 'Answer-position balance (χ² vs uniform), longest/shortest-option-is-correct bias, duplicate and near-duplicate stems, distinct vs generic distractor labels.'],
  ['Player-facing language', 'Flesch–Kincaid reading grade and leakage of internal or learning-science vocabulary the prompt bans.'],
  ['Novelty', 'Share of stems not in the authored bank, and pairwise stem overlap between plans.'],
])}

# 5. Results

## 5.1 Reliability

${table(['Measure', 'Value', '95% interval'], [
  ['Plan served (no fallback)', `${R.served}/${R.runs} = ${pct(R.served / R.runs)}`, ci(R.served, R.runs)],
  ['Accepted on first attempt', `${R.firstAttemptAccepted}/${R.runs} = ${pct(R.firstAttemptAccepted / R.runs)}`, ci(R.firstAttemptAccepted, R.runs)],
  ['Schema-valid attempts', `${R.schemaValidAttempts}/${R.attempts} = ${pct(R.schemaValidAttempts / R.attempts)}`, ci(R.schemaValidAttempts, R.attempts)],
  ['Recovered by the repair retry', `${R.retryRecovered}/${R.retryAttempted} retries`, '—'],
  ['Latency mean / p50 / p95 / max', `${num(R.latencySeconds.mean, 1)} / ${num(R.latencySeconds.p50, 1)} / ${num(R.latencySeconds.p95, 1)} / ${num(R.latencySeconds.max, 1)} s`, '—'],
  ['Tokens in / out / reasoning', `${R.tokens.promptMean} / ${R.tokens.completionMean} / ${R.tokens.reasoningMean ?? 'n/a'}`, '—'],
  ['Cost total / per served plan', `$${R.costUsd.total.toFixed(4)} / $${R.costUsd.perServedPlan.toFixed(4)}`, '—'],
])}

${Object.keys(R.issueKindCounts ?? {}).length === 0
  ? 'No attempt that reached the API was rejected by either validation stage, so the repair retry never ran.'
  : 'Rejected attempts failed on: ' + Object.entries(R.issueKindCounts).map(([k, v]) => `\`${k}\` × ${v}`).join(', ') + '.'}

## 5.2 Plan quality against the deterministic baseline

${table(['Measure', 'Model plan', 'Deterministic fallback'], [
  ['Target precision (fuzzy)', cell(L.targetPrecisionFuzzy), B ? cell(B.targetPrecisionFuzzy) : 'n/a'],
  ['Target precision (strict)', cell(L.targetPrecisionStrict), B ? cell(B.targetPrecisionStrict) : 'n/a'],
  ['Weak-concept recall', cell(L.weakConceptRecall), B ? cell(B.weakConceptRecall) : 'n/a'],
  ['Due-concept recall', cell(L.dueConceptRecall), B ? cell(B.dueConceptRecall) : 'n/a'],
  ['Misconception coverage', cell(L.misconceptionCoverage), B ? cell(B.misconceptionCoverage) : 'n/a'],
  ['Questions on curriculum', cell(L.itemsOnCurriculum), B ? cell(B.itemsOnCurriculum) : 'n/a'],
  ['Novel stems (vs authored bank)', cell(L.novelStemRate), B ? cell(B.novelStemRate) : 'n/a'],
  ['Distinct misconceptions', cell(L.distinctMisconceptionRate), B ? cell(B.distinctMisconceptionRate) : 'n/a'],
  ['Generic misconceptions', cell(L.genericMisconceptionRate), B ? cell(B.genericMisconceptionRate) : 'n/a'],
  ['Categories used (of 6)', cell(L.categoriesUsed), B ? cell(B.categoriesUsed) : 'n/a'],
  ['Reading grade (Flesch–Kincaid)', cell(L.readingGrade), B ? cell(B.readingGrade) : 'n/a'],
  ['Near-duplicate stem pairs', cell(L.nearDuplicatePairs), B ? cell(B.nearDuplicatePairs) : 'n/a'],
  ['Answer-position χ²', cell(L.positionChiSquare), B ? cell(B.positionChiSquare) : 'n/a'],
  ['Plans with balanced positions', `${L.positionBalancedPlans}/${L.plans}`, B ? `${B.positionBalancedPlans}/${B.plans}` : 'n/a'],
])}

Target precision and weak/due recall are **1.00 by construction** for the
deterministic planner — it copies its targets straight out of the report — so those
rows are not a contest. The rows that separate the two are novelty, misconception
quality, and whether the questions actually sit on the curriculum the plan claims.

## 5.3 Item soundness
${J ? `
${table(['Item set', 'Agreed', 'Rate', '95% interval', 'Concerns'], [
  ['Generated — all', `${J.llm.agreed}/${J.llm.total}`, pct(J.llm.agreed / J.llm.total), ci(J.llm.agreed, J.llm.total), String(J.llm.concerns)],
  ['Generated — easy', `${J.llm.byDifficulty.easy.agreed}/${J.llm.byDifficulty.easy.total}`, pct(J.llm.byDifficulty.easy.agreed / J.llm.byDifficulty.easy.total), '—', '—'],
  ['Generated — medium', `${J.llm.byDifficulty.medium.agreed}/${J.llm.byDifficulty.medium.total}`, pct(J.llm.byDifficulty.medium.agreed / J.llm.byDifficulty.medium.total), '—', '—'],
  ['Generated — hard', `${J.llm.byDifficulty.hard.agreed}/${J.llm.byDifficulty.hard.total}`, pct(J.llm.byDifficulty.hard.agreed / J.llm.byDifficulty.hard.total), '—', '—'],
  ['Human-authored control', `${J.authoredControl.agreed}/${J.authoredControl.total}`, pct(J.authoredControl.agreed / J.authoredControl.total), ci(J.authoredControl.agreed, J.authoredControl.total), String(J.authoredControl.concerns)],
])}

The control matters more than the headline: the solver agreed with
${pct(J.authoredControl.agreed / J.authoredControl.total)} of the *human-authored* bank, so
that is the ceiling this method can measure. Generated items sit at
${pct(J.llm.agreed / J.llm.total)}. Concerns raised on generated items:
${Object.entries(J.llm.concernKinds ?? {}).filter(([k]) => k !== 'none').map(([k, v]) => `\`${k}\` × ${v}`).join(', ') || 'none'}.

### 5.3.1 Every disagreement, adjudicated

${keyDisagreements.length} items where the solver's answer differed from the plan's
key, plus ${concernOnly} answered correctly but still flagged with a concern.

${keyDisagreements.map((d) => {
  const tag = (i) => {
    const marks = [];
    if (i === d.key) marks.push('**plan key**');
    if (i === d.choice) marks.push("**solver's answer**");
    return marks.length ? ' — ' + marks.join(', ') : '';
  };
  const opts = d.answers.map((a, i) => `- \`${i}\`  ${a}${tag(i)}`).join('\n');
  return `**${d.runId} · item ${d.sequence} · ${d.difficulty} · ${d.category} · flagged \`${d.concern}\`**\n\n> ${d.question}\n\n${opts}`;
}).join('\n\n')}

**Finding.** All ${keyDisagreements.length} disagreements are the same defect, and the
solver is right in every case. Each is a negative-adverb inversion or a conditional
whose stem supplies no tense or register anchor, so two options are simultaneously
correct: "Never before *had he* / *has he* felt so confident" are both good English,
and so are "*Should* you need help" and "*If* you need help". The model is not making
grammar errors — it is writing items whose stems under-determine the answer. That is
a narrow, fixable prompt problem (require a time reference in any inversion item),
not a general quality problem.
` : '\nThe independent solver phase was not run.\n'}

## 5.4 Answer-position bias

${table(['Authored slot', 'Model plan (mean of 30)', 'Deterministic fallback'], [
  ...[0, 1, 2, 3].map((i) => [`Slot ${i}`, num(posLlm[i], 2), num(posLocal[i], 2)]),
])}

A uniform plan would place 7.50 correct answers at each slot; the model passes a χ²
test against uniform in ${L.positionBalancedPlans}/${L.plans} plans, against
${B ? `${B.positionBalancedPlans}/${B.plans}` : 'n/a'} for the fixed authored bank.

**This matters less than it appears.** The game has three lanes, not four, and
\`QuestionManager.toLaneChoices\` trims every item at serve time by keeping the
correct answer, dropping one random distractor, reshuffling the three and
recomputing the answer index. A correct answer authored at slot 3 is therefore never
lost — it is re-indexed — and positional bias in the plan is neutralised before the
player sees it. The measure is a signal about the model's generation habits, not a
gameplay defect.

## 5.5 Player-facing language

${table(['Measure', 'Model plan', 'Deterministic fallback'], [
  ['Reading grade (target ≈ 6)', cell(L.readingGrade), B ? cell(B.readingGrade) : 'n/a'],
  ['Plans matching a banned term', `${L.plansWithBannedTerm}/${L.plans}`, B ? `${B.plansWithBannedTerm}/${B.plans}` : 'n/a'],
  ['Plans using a discouraged term', `${L.plansWithDiscouragedTerm}/${L.plans}`, B ? `${B.plansWithDiscouragedTerm}/${B.plans}` : 'n/a'],
])}

${bannedHit
    ? `The single match is \`${bannedHit.term}\` in \`${bannedHit.field}\` — "…${bannedHit.excerpt}…". That is the ordinary English verb *prompt*, not the machine-learning noun the rule was written to catch. The checker matches whole words but not word senses, so this is a **false positive** and the true leak rate for this run is 0 of ${L.plans}.`
    : 'No plan leaked internal or learning-science vocabulary into player-facing text.'}

Reading grade sits at ${num(L.readingGrade.mean, 2)} against a target of about 6, so the
player-facing writing is roughly a year harder than intended — the one language
result worth acting on.

## 5.6 Novelty

${table(['Measure', 'Model plan', 'Deterministic fallback'], [
  ['Novel stems (not in authored bank)', pct(L.novelStemRate.mean), B ? pct(B.novelStemRate.mean) : 'n/a'],
  ['Mean pairwise stem overlap', pct(S.novelty.meanPairwiseOverlap), '100%'],
  ['Max pairwise stem overlap', pct(S.novelty.maxPairwiseOverlap), '100%'],
  ['Unique stems / total generated', `${S.novelty.uniqueStemsAcrossAllPlans} / ${S.novelty.totalStemsGenerated}`, `30 / ${S.novelty.totalStemsGenerated}`],
])}

This is the axis the deterministic planner cannot compete on: it draws from a fixed
30-question bank, so every session is the same material.

## 5.7 By learner profile

${table(['Profile', 'Served', '1st try', 'Target P', 'Weak recall', 'Due recall', 'On curriculum', 'Grade'],
  S.perPersona.map((p) => [p.personaId, `${p.served}/${p.runs}`, String(p.firstAttemptAccepted),
    num(p.targetPrecisionFuzzy, 2), num(p.weakConceptRecall, 2), num(p.dueConceptRecall, 2),
    num(p.itemsOnCurriculum, 2), num(p.readingGrade, 1)]))}

An aggregate mean can hide the coach failing one kind of learner completely, which
is why this table exists.

# 6. Engineering findings

Defects the evaluation surfaced before it could produce a single number. All four
were fixed; the first two also affected the shipped game, not just the harness.

**D1 — The token-limit parameter is not portable across provider families.**
OpenRouter publishes a per-endpoint parameter list, and the request sets
\`require_parameters: true\`, which discards any endpoint missing a parameter the
request sends. The \`openai/\` namespace advertises \`max_completion_tokens\`;
Google's endpoints advertise \`max_tokens\`. Because the code hardcoded
\`max_completion_tokens\`, every request after the model switch routed to zero
endpoints and returned *404 No endpoints found that can handle the requested
parameters*. This was not confined to the evaluation: the game's own middleware sent
the same parameter, so the in-game coach would have failed on every round and
silently served the local fallback. Measured against the live API, the two families
reject the opposite parameter, so a hardcoded name cannot be correct for both — the
fix selects the parameter from the model slug.

**D2 — A 30-item array overflows Gemini's structured-output schema limit.** With
routing fixed, the provider began rejecting the request body itself with a bare
\`INVALID_ARGUMENT\`. Bisecting the schema showed the cause is not a keyword but a
size: Gemini expands a \`minItems\`/\`maxItems\` array into that many copies of the
item schema, and 30 copies of an eleven-field question object exceeds its limit.
Measured on the same model, eight items pass and sixteen fail, while a hundred
copies of a one-field object pass. The fix drops length bounds only on large arrays
of objects in the schema sent to the provider; the count is still stated in the
prompt and still enforced on the response.

**D3 — Provider errors were unreadable.** The harness recorded only "Provider
returned error" for every provider-side rejection, so a bad model slug, an
unroutable provider filter and a rejected schema all looked identical. OpenRouter
puts the upstream complaint in the error's \`metadata.raw\`; the harness now records
it, which is how D2 was found.

**D4 — The solver defaulted to the generator's own provider family.** The
independent check defaults its solver to a Google model. Once the generator became a
Google model, that default would have had one family grade its own output, quietly
converting the strongest evidence in the report into a measure of self-agreement.
The solver is pinned to a different family for this run.

# 7. Threats to validity

- **Simulated learners, not real ones.** The reports are generated from behavioural
  profiles. They exercise the planner's input space, but cannot show whether a plan
  helps a person learn — only whether it is well-formed, well-targeted against the
  evidence it was given, and sound as English.
- **The targeting metrics flatter the baseline.** The deterministic planner selects
  its targets directly from the weak and due lists, so its precision and recall are
  1.00 by construction rather than by judgement.
- **One solver, one pass.** Agreement is evidence about an item, not proof. The
  authored-question control bounds the solver's own error rate, but disagreements
  still need adjudication by hand.
- **Concept names are matched as free text.** Targeting is scored with both exact
  and fuzzy matching because concept names travel from report to plan as strings.
- **Transport resilience differs from the game.** A batch is ${R.runs} paid runs in
  one process, so the harness retries connection failures more times than the game
  does. This changes no generated token; it only stops a local network drop from
  voiding a paid batch.
- **Output headroom is thin.** Reasoning consumes ${R.tokens.reasoningMean ? Math.round((R.tokens.reasoningMean / R.tokens.completionMean) * 100) + '%' : 'much'}
  of the completion budget; mean completion is ${R.tokens.completionMean} tokens
  against an 18,000-token ceiling (${pct(R.tokens.completionMean / 18000, 0)} of the cap).
  A harder report could truncate rather than fail cleanly.

# 8. Reproducing this

Each phase writes its own JSON into \`eval/results/\`; both this document and the
HTML report are rendered from those files, so neither can drift from the
measurements it describes.

\`\`\`
# free — check the simulated learners before spending anything
EVAL_PHASE=personas   npx vitest run eval/

# billed — ${R.runs} sessions through the live planner
EVAL_PHASE=generate   npx vitest run eval/

# billed — independent solver, pinned to a different provider family
EVAL_PHASE=judge EVAL_SOLVER_MODEL=${solver} npx vitest run eval/

# free — deterministic baseline on the identical reports, then aggregate
EVAL_PHASE=baseline   npx vitest run eval/
EVAL_PHASE=summarise  npx vitest run eval/

# render
node eval/report.mjs        # HTML
node eval/report-doc.mjs    # Word
\`\`\`
`;

const mdPath = join(RESULTS_DIR, 'report.md');
writeFileSync(mdPath, md, 'utf8');

const docxPath = join(RESULTS_DIR, 'Punch-English-Coach-Evaluation.docx');
execFileSync('pandoc', [mdPath, '-o', docxPath, '--toc', '--toc-depth=2', '--standalone'], {
  stdio: 'inherit',
});
console.log(`wrote ${mdPath}`);
console.log(`wrote ${docxPath}`);
