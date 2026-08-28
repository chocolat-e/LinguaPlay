import {
  AiPlanSchema,
  findPlanIssues,
  planToQuestions,
  type AdaptivePackage,
  type LearnerReport,
} from './contracts';
import { createLocalPlan } from './localPlanner';

interface ApiResponse {
  plan?: unknown;
  model?: unknown;
  generatedAt?: unknown;
  error?: unknown;
}

export interface CoachResult {
  package: AdaptivePackage;
  message: string | null;
}

export async function requestAdaptivePlan(report: LearnerReport): Promise<CoachResult> {
  const controller = new AbortController();
  // Plain timers, not `window.*`, so the adaptive layer also runs under test.
  const timeout = setTimeout(() => controller.abort(), 105_000);

  try {
    const response = await fetch('/api/punchkt/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report }),
      signal: controller.signal,
    });
    const body = await response.json() as ApiResponse;
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Coach request failed.');

    const parsed = AiPlanSchema.safeParse(body.plan);
    if (!parsed.success) throw new Error('The coach returned an invalid plan shape.');
    const issues = findPlanIssues(parsed.data);
    if (issues.length > 0) throw new Error(`The coach plan failed validation: ${issues[0]}`);

    const model = typeof body.model === 'string' ? body.model : 'openai/gpt-5.6-terra';
    const generatedAt = typeof body.generatedAt === 'string' ? body.generatedAt : new Date().toISOString();
    return {
      package: {
        source: 'llm',
        model,
        generatedAt,
        feedback: parsed.data.feedback,
        curriculum: parsed.data.curriculum,
        questions: planToQuestions(parsed.data, 'llm'),
      },
      message: null,
    };
  } catch (error) {
    // The real reason is for whoever is running the game, not for the player —
    // "invalid plan shape" means nothing to someone learning English.
    console.warn('[coach] falling back to the built-in question set:', error);
    return {
      package: createLocalPlan(report),
      message: 'Your coach could not be reached, so this round uses the built-in practice questions.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
