/**
 * Phase 2 — independent answer-key check.
 *
 * A model from a different provider family answers every generated item without
 * being shown the key, so agreement is evidence about the item rather than a
 * model agreeing with itself. The same solver also answers the 30 human-authored
 * questions, which gives the disagreement rate a floor to be measured against:
 * whatever the solver gets "wrong" on hand-written items is the solver's own
 * error, not the generator's.
 *
 * Disagreements are candidates, not verdicts. Every one is adjudicated by hand
 * afterwards from `results/disagreements.json`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import QUESTIONS from '../src/data/questions';
import { RESULTS_DIR, environment, type GenerateOutput } from './generate';
import { tokenLimitFor } from '../server/punchKtApi.ts';

const SOLVER_DEFAULT = 'google/gemini-3.7-flash';
const CONCURRENCY = 4;

const SOLVER_PROMPT = `You are an experienced English teacher checking multiple-choice questions for a learning game.

For each question you are given the stem and four options. You are NOT told which option is correct.

For every question return:
- "choice": the index (0-3) of the option you judge to be the single best answer.
- "confidence": how sure you are.
- "concern": "none" if the item is sound, otherwise the single biggest problem —
  "multiple-correct" if two or more options are defensible,
  "no-correct" if none of the options is right,
  "ambiguous-stem" if the question does not determine one answer,
  "overlapping-options" if two options mean the same thing.

Judge the English on its merits. Do not guess what the item writer intended.`;

const SolutionSchema = z.object({
  solutions: z.array(
    z.object({
      sequence: z.number().int(),
      choice: z.number().int().min(0).max(3),
      confidence: z.enum(['high', 'medium', 'low']),
      concern: z.enum([
        'none',
        'multiple-correct',
        'no-correct',
        'ambiguous-stem',
        'overlapping-options',
      ]),
    }),
  ),
});

interface JudgedItem {
  source: string;
  runId: string;
  sequence: number;
  question: string;
  answers: string[];
  key: number;
  choice: number;
  agreed: boolean;
  confidence: string;
  concern: string;
  difficulty: string;
  category: string;
}

export interface JudgeOutput {
  solverModel: string;
  finishedAt: string;
  items: JudgedItem[];
  costUsd: number;
  failures: string[];
}

interface Askable {
  runId: string;
  source: string;
  questions: Array<{
    sequence: number;
    question: string;
    answers: string[];
    correctAnswer: number;
    difficulty: string;
    category: string;
  }>;
}

async function solve(
  client: OpenAI,
  model: string,
  batch: Askable,
): Promise<{ items: JudgedItem[]; cost: number; error: string | null }> {
  const payload = batch.questions.map((question) => ({
    sequence: question.sequence,
    question: question.question,
    options: question.answers,
  }));

  try {
    const completion = (await client.chat.completions.create({
      model,
      ...tokenLimitFor(model, 12_000),
      messages: [
        { role: 'system', content: SOLVER_PROMPT },
        { role: 'user', content: `Answer every question.\n${JSON.stringify(payload, null, 1)}` },
      ],
      response_format: zodResponseFormat(SolutionSchema, 'solutions'),
      usage: { include: true },
    } as never)) as OpenAI.Chat.Completions.ChatCompletion & { usage?: { cost?: number } };

    const content = completion.choices[0]?.message.content;
    if (!content) return { items: [], cost: 0, error: `${batch.runId}: empty solver response` };
    const parsed = SolutionSchema.parse(JSON.parse(content));
    const bySequence = new Map(parsed.solutions.map((entry) => [entry.sequence, entry]));

    const items: JudgedItem[] = [];
    for (const question of batch.questions) {
      const solution = bySequence.get(question.sequence);
      if (!solution) continue;
      items.push({
        source: batch.source,
        runId: batch.runId,
        sequence: question.sequence,
        question: question.question,
        answers: question.answers,
        key: question.correctAnswer,
        choice: solution.choice,
        agreed: solution.choice === question.correctAnswer,
        confidence: solution.confidence,
        concern: solution.concern,
        difficulty: question.difficulty,
        category: question.category,
      });
    }
    return { items, cost: completion.usage?.cost ?? 0, error: null };
  } catch (error) {
    return { items: [], cost: 0, error: `${batch.runId}: ${(error as Error).message}` };
  }
}

export async function judge(log: (line: string) => void): Promise<JudgeOutput> {
  const env = environment();
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in software/.env.local');
  const model = env.EVAL_SOLVER_MODEL?.trim() || SOLVER_DEFAULT;

  const generated = JSON.parse(
    readFileSync(join(RESULTS_DIR, 'runs.json'), 'utf8'),
  ) as GenerateOutput;

  const batches: Askable[] = [];
  // Control: the human-authored bank, answered by the same solver.
  batches.push({
    runId: 'AUTHORED-BANK',
    source: 'authored',
    questions: QUESTIONS.map((question, index) => ({
      sequence: index + 1,
      question: question.question,
      answers: question.answers,
      correctAnswer: question.correctAnswer,
      difficulty: question.difficulty,
      category: question.category,
    })),
  });
  for (const run of generated.runs) {
    if (!run.plan) continue;
    batches.push({
      runId: run.runId,
      source: 'llm',
      questions: run.plan.questions.map((question) => ({
        sequence: question.sequence,
        question: question.question,
        answers: question.answers,
        correctAnswer: question.correctAnswer,
        difficulty: question.difficulty,
        category: question.category,
      })),
    });
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 180_000,
    maxRetries: 2,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:5173',
      'X-OpenRouter-Title': 'Punch English eval',
    },
  });

  log(`solver=${model} batches=${batches.length}`);
  const items: JudgedItem[] = [];
  const failures: string[] = [];
  let costUsd = 0;
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= batches.length) return;
        const batch = batches[index];
        const result = await solve(client, model, batch);
        if (result.error) {
          failures.push(result.error);
          log(`  ${batch.runId}: FAILED ${result.error}`);
        } else {
          const agreed = result.items.filter((item) => item.agreed).length;
          log(`  ${batch.runId}: ${agreed}/${result.items.length} agreed`);
        }
        items.push(...result.items);
        costUsd += result.cost;
      }
    }),
  );

  const output: JudgeOutput = {
    solverModel: model,
    finishedAt: new Date().toISOString(),
    items,
    costUsd,
    failures,
  };
  writeFileSync(join(RESULTS_DIR, 'judge.json'), JSON.stringify(output, null, 2), 'utf8');

  // Everything the solver did not agree with, for hand adjudication.
  const disagreements = items.filter((item) => !item.agreed || item.concern !== 'none');
  writeFileSync(
    join(RESULTS_DIR, 'disagreements.json'),
    JSON.stringify(disagreements, null, 2),
    'utf8',
  );
  log(`wrote judge.json (${items.length} items, \$${costUsd.toFixed(4)})`);
  log(`wrote disagreements.json (${disagreements.length} items to adjudicate)`);
  return output;
}
