/**
 * Phase 1 — generate plans.
 *
 * The request mirrors `server/punchKtApi.ts` field for field: same exported
 * system prompt, same model, same token ceiling, same structured-output schema,
 * same provider filter, and the same two-attempt repair loop. The only addition
 * is `usage.include`, which asks OpenRouter to return the billed cost and
 * changes nothing about generation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { loadEnv } from 'vite';
import { AiPlanSchema, findPlanIssues, type AiPlan } from '../src/adaptive/contracts';
import { PLAN_RESPONSE_FORMAT, SYSTEM_PROMPT, tokenLimitFor } from '../server/punchKtApi.ts';
import { buildPersonaCases, type PersonaCase } from './personas';
import { issueKind } from './metrics';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL_DEFAULT = 'google/gemini-3.1-pro-preview';
const MAX_ATTEMPTS = 2;
const CONCURRENCY = 4;

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
export const SOFTWARE_DIR = join(EVAL_DIR, '..');
export const RESULTS_DIR = join(EVAL_DIR, 'results');

export interface AttemptRecord {
  attempt: number;
  latencyMs: number;
  httpOk: boolean;
  jsonParsed: boolean;
  schemaValid: boolean;
  semanticIssues: string[];
  issueKinds: string[];
  accepted: boolean;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface RunRecord {
  runId: string;
  personaId: string;
  personaLabel: string;
  seed: number;
  attempts: AttemptRecord[];
  served: boolean;
  acceptedOnAttempt: number | null;
  totalLatencyMs: number;
  plan: AiPlan | null;
}

export interface GenerateOutput {
  startedAt: string;
  finishedAt: string;
  model: string;
  repeats: number;
  simulationNow: number;
  runs: RunRecord[];
  reports: Array<{ runId: string; report: unknown }>;
}

export function environment(): Record<string, string> {
  return loadEnv('development', SOFTWARE_DIR, '');
}

function usageOf(completion: unknown): {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
} {
  const usage = (completion as { usage?: Record<string, unknown> } | null)?.usage;
  const details = usage?.completion_tokens_details as { reasoning_tokens?: number } | undefined;
  return {
    promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
    reasoningTokens: typeof details?.reasoning_tokens === 'number' ? details.reasoning_tokens : null,
    costUsd: typeof usage?.cost === 'number' ? usage.cost : null,
  };
}

async function runOne(
  client: OpenAI,
  model: string,
  personaCase: PersonaCase,
  runId: string,
  log: (line: string) => void,
): Promise<RunRecord> {
  const reportJson = JSON.stringify(personaCase.report);
  let userPrompt = `Plan the next level from this learner report:\n${reportJson}`;
  const attempts: AttemptRecord[] = [];
  let plan: AiPlan | null = null;
  let acceptedOnAttempt: number | null = null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const attemptStart = Date.now();
    const record: AttemptRecord = {
      attempt,
      latencyMs: 0,
      httpOk: false,
      jsonParsed: false,
      schemaValid: false,
      semanticIssues: [],
      issueKinds: [],
      accepted: false,
      finishReason: null,
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      costUsd: null,
      error: null,
    };

    try {
      const completion = await client.chat.completions.create({
        model,
        ...tokenLimitFor(model, 18_000),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: PLAN_RESPONSE_FORMAT,
        provider: { require_parameters: true, data_collection: 'deny', zdr: true },
        usage: { include: true },
      } as never);

      record.latencyMs = Date.now() - attemptStart;
      record.httpOk = true;
      Object.assign(record, usageOf(completion));
      const choice = (completion as OpenAI.Chat.Completions.ChatCompletion).choices[0];
      record.finishReason = choice?.finish_reason ?? null;
      const content = choice?.message.content;

      if (!content) {
        record.error = 'empty content';
      } else {
        let raw: unknown;
        try {
          raw = JSON.parse(content);
          record.jsonParsed = true;
        } catch (error) {
          record.error = `json: ${(error as Error).message}`;
        }
        if (record.jsonParsed) {
          const parsed = AiPlanSchema.safeParse(raw);
          record.schemaValid = parsed.success;
          if (!parsed.success) {
            record.error = `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
          } else {
            const issues = findPlanIssues(parsed.data);
            record.semanticIssues = issues;
            record.issueKinds = [...new Set(issues.map(issueKind))];
            record.accepted = issues.length === 0;
            if (record.accepted) {
              plan = parsed.data;
              acceptedOnAttempt = attempt;
            }
          }
        }
      }
    } catch (error) {
      record.latencyMs = Date.now() - attemptStart;
      // OpenRouter puts the upstream provider's real complaint in `error.error`
      // (`metadata.raw`); `error.message` alone flattens every provider-side
      // rejection into "Provider returned error", which is undiagnosable.
      record.error =
        error instanceof OpenAI.APIError
          ? `api ${error.status ?? '?'}: ${error.message} ${JSON.stringify(error.error ?? {}).slice(0, 400)}`
          : (error as Error).message;
    }

    attempts.push(record);
    log(
      `  ${runId} attempt ${attempt}: ${record.accepted ? 'ACCEPTED' : 'rejected'} ` +
        `(${(record.latencyMs / 1000).toFixed(1)}s, ${record.completionTokens ?? '?'} out tok` +
        `${record.error ? `, ${record.error}` : ''}${record.semanticIssues.length ? `, ${record.semanticIssues.length} issue(s)` : ''})`,
    );
    if (record.accepted) break;

    userPrompt = `Generate the entire curriculum again from the report below and fix every validation issue.\n\nLearner report:\n${reportJson}\n\nValidation issues:\n${attempts[attempts.length - 1].semanticIssues.join('\n')}`;
  }

  return {
    runId,
    personaId: personaCase.spec.id,
    personaLabel: personaCase.spec.label,
    seed: personaCase.seed,
    attempts,
    served: plan !== null,
    acceptedOnAttempt,
    totalLatencyMs: Date.now() - startedAt,
    plan,
  };
}

/** Small fixed-size worker pool; results keep their input order. */
async function pool<T, R>(items: T[], size: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function generate(repeats: number, log: (line: string) => void): Promise<GenerateOutput> {
  const env = environment();
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in software/.env.local');
  const model = env.OPENROUTER_MODEL?.trim() || MODEL_DEFAULT;

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: 100_000,
    // The game uses 1. A batch is 32 paid runs in one process, and a brief
    // local network drop once cost 39 of 52 attempts here — transport failures
    // that never reached a model and so measure nothing about it. Retrying the
    // connection changes no generated token; it only stops a blip from voiding
    // the batch. Model-level outcomes are still recorded exactly once.
    maxRetries: 4,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:5173',
      'X-OpenRouter-Title': 'Punch English',
    },
  });

  // One fixed clock for the whole batch keeps every simulated report reproducible.
  const simulationNow = Date.UTC(2026, 8, 2, 9, 0, 0);
  const limit = Number(env.EVAL_LIMIT ?? process.env.EVAL_LIMIT ?? '0');
  const allCases = buildPersonaCases(repeats, simulationNow);
  // EVAL_LIMIT trims the batch for a cheap end-to-end smoke test of the harness.
  const cases = limit > 0 ? allCases.slice(0, limit) : allCases;
  const startedAt = new Date().toISOString();
  log(`model=${model} runs=${cases.length} concurrency=${CONCURRENCY}`);

  const runs = await pool(cases, CONCURRENCY, (personaCase, index) =>
    runOne(
      client,
      model,
      personaCase,
      `R${String(index + 1).padStart(2, '0')}-${personaCase.spec.id}`,
      log,
    ),
  );

  const output: GenerateOutput = {
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    repeats,
    simulationNow,
    runs,
    reports: cases.map((personaCase, index) => ({
      runId: runs[index].runId,
      report: personaCase.report,
    })),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, 'runs.json'), JSON.stringify(output, null, 2), 'utf8');
  log(`wrote ${join(RESULTS_DIR, 'runs.json')}`);
  return output;
}
