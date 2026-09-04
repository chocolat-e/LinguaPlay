/**
 * Entry point for the coach evaluation.
 *
 * It lives in a test file only because vitest is the project's TypeScript
 * runner; it is inert during `npm test` and does nothing unless EVAL_PHASE is
 * set. Phases run in order:
 *
 *   EVAL_PHASE=personas   npx vitest run eval/     # free: check the inputs
 *   EVAL_PHASE=generate   npx vitest run eval/     # billed: calls the coach
 *   EVAL_PHASE=judge      npx vitest run eval/     # billed: independent solver
 *   EVAL_PHASE=summarise  npx vitest run eval/     # free: aggregates results
 */
import { describe, it } from 'vitest';

const PHASE = process.env.EVAL_PHASE ?? '';
const REPEATS = Number(process.env.EVAL_REPEATS ?? '4');
const HOUR = 60 * 60 * 1000;

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

describe.skipIf(PHASE === '')('coach evaluation', () => {
  it.runIf(PHASE === 'personas')('builds learner reports', async () => {
    const { buildPersonaCases } = await import('./personas');
    const { PERSONAS } = await import('./personas');
    const cases = buildPersonaCases(REPEATS, Date.UTC(2026, 8, 2, 9, 0, 0));
    log(`cases: ${cases.length}`);
    const mean = (values: number[]): number =>
      values.reduce((total, value) => total + value, 0) / values.length;

    for (const spec of PERSONAS) {
      const mine = cases.filter((item) => item.spec.id === spec.id).map((item) => item.report);
      log(
        [
          spec.id.padEnd(28),
          `session ${mine[0].sessionNumber}`,
          `acc ${(mean(mine.map((r) => r.summary.accuracy)) * 100).toFixed(1)}% (target ${(spec.baseAccuracy * 100).toFixed(0)}%)`,
          `miss ${(mean(mine.map((r) => r.summary.missed / r.game.sessionQuestions)) * 100).toFixed(0)}% (target ${(spec.missRate * 100).toFixed(0)}%)`,
          `early ${(mean(mine.map((r) => r.motorEvidence.earlyPunchRate)) * 100).toFixed(0)}% (target ${(spec.earlyRate * 100).toFixed(0)}%)`,
          `concepts ${mean(mine.map((r) => r.punchKT.concepts.length)).toFixed(0)}`,
          `due ${mean(mine.map((r) => r.forgettingAware.dueConcepts.length)).toFixed(1)}`,
          `misc ${mean(mine.map((r) => r.misconceptionEvidence.length)).toFixed(1)}`,
          `bytes ${mean(mine.map((r) => JSON.stringify(r).length)).toFixed(0)}`,
        ].join(' | '),
      );
    }
  });

  it.runIf(PHASE === 'generate')(
    'generates plans from the live coach',
    async () => {
      const { generate } = await import('./generate');
      const output = await generate(REPEATS, log);
      const served = output.runs.filter((run) => run.served).length;
      log(`served ${served}/${output.runs.length}`);
    },
    3 * HOUR,
  );

  it.runIf(PHASE === 'judge')(
    'scores plans with an independent solver',
    async () => {
      const { judge } = await import('./judge');
      await judge(log);
    },
    3 * HOUR,
  );

  it.runIf(PHASE === 'baseline')('measures the fallback planner', async () => {
    const { baseline } = await import('./summarise');
    await baseline(REPEATS, log);
  });

  it.runIf(PHASE === 'summarise')('aggregates every measurement', async () => {
    const { summarise } = await import('./summarise');
    await summarise(log);
  });
});
