import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import QUESTIONS from './src/data/questions.ts';
import { tokenLimitFor } from './server/punchKtApi.ts';

const model = process.env.EVAL_SOLVER_MODEL ?? 'openai/gpt-5.6-terra';
const SolutionSchema = z.object({
  solutions: z.array(z.object({
    sequence: z.number().int(),
    choice: z.number().int().min(0).max(3),
    confidence: z.enum(['high', 'medium', 'low']),
    concern: z.enum(['none', 'multiple-correct', 'no-correct', 'ambiguous-stem', 'overlapping-options']),
  })),
});

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  timeout: 180_000,
  maxRetries: 2,
});

const payload = QUESTIONS.map((q, i) => ({ sequence: i + 1, question: q.question, options: q.answers }));
const started = Date.now();
const completion = (await client.chat.completions.create({
  model,
  ...tokenLimitFor(model, 12_000),
  messages: [
    { role: 'system', content: 'You are an experienced English teacher checking multiple-choice questions for a learning game.\n\nFor each question you are given the stem and four options. You are NOT told which option is correct.\n\nFor every question return:\n- "choice": the index (0-3) of the option you judge to be the single best answer.\n- "confidence": how sure you are.\n- "concern": "none" if the item is sound, otherwise the single biggest problem.\n\nJudge the English on its merits.' },
    { role: 'user', content: `Answer every question.\n${JSON.stringify(payload, null, 1)}` },
  ],
  response_format: zodResponseFormat(SolutionSchema, 'solutions'),
  usage: { include: true },
} as never)) as OpenAI.Chat.Completions.ChatCompletion & { usage?: { cost?: number; completion_tokens?: number } };

const choice = completion.choices[0];
console.log('finish_reason:', choice?.finish_reason);
console.log('completion tokens:', completion.usage?.completion_tokens, '/ cap 12000');
console.log('cost: $' + (completion.usage?.cost ?? 0).toFixed(5), '| latency', ((Date.now() - started) / 1000).toFixed(0) + 's');
const parsed = SolutionSchema.parse(JSON.parse(choice!.message.content!));
console.log('solutions returned:', parsed.solutions.length, 'of', QUESTIONS.length);
const agreed = parsed.solutions.filter((s) => QUESTIONS[s.sequence - 1].correctAnswer === s.choice).length;
console.log('agreement on AUTHORED bank:', agreed + '/' + parsed.solutions.length);
