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
  const timeout = window.setTimeout(() => controller.abort(), 105_000);

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
    const reason = error instanceof Error ? error.message : 'The AI coach was unavailable.';
    return {
      package: createLocalPlan(report),
      message: `${reason} A deterministic PunchKT plan was prepared instead.`,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
