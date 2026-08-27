import type { LearnerReport } from './contracts';
import type { AnswerRecord, Category, SessionStats } from '../game/types';

const STORAGE_KEY = 'punch-english:punchkt:v1';
const RETENTION_THRESHOLD = 0.65;
const HOUR_MS = 60 * 60 * 1000;

interface StoredConcept {
  category: Category;
  exposures: number;
  correct: number;
  wrong: number;
  alpha: number;
  beta: number;
  halfLifeHours: number;
  lastEvidenceAt: number | null;
}

interface StoredMisconception {
  component: string;
  label: string;
  count: number;
  lastSeenAt: number;
}

interface StoredProfile {
  version: 1;
  sessionsCompleted: number;
  concepts: Record<string, StoredConcept>;
  misconceptions: Record<string, StoredMisconception>;
}

const emptyProfile = (): StoredProfile => ({
  version: 1,
  sessionsCompleted: 0,
  concepts: {},
  misconceptions: {},
});

/**
 * Compact, persistent PunchKT-style learner state.
 *
 * Semantic evidence (right/wrong answer) updates knowledge. A missed block is
 * kept as motor evidence and never silently treated as an English mistake.
 */
export class PunchKTLearner {
  private profile: StoredProfile;

  constructor() {
    this.profile = this.load();
  }

  record(record: AnswerRecord): void {
    const component = this.profile.concepts[record.knowledgeComponent] ?? {
      category: record.category,
      exposures: 0,
      correct: 0,
      wrong: 0,
      alpha: 1,
      beta: 1,
      halfLifeHours: 24,
      lastEvidenceAt: null,
    };

    component.exposures += 1;
    component.category = record.category;

    if (record.outcome === 'CORRECT') {
      component.correct += 1;
      component.alpha += 1;
      component.halfLifeHours = clamp(component.halfLifeHours * 1.7, 2, 24 * 30);
      component.lastEvidenceAt = record.recordedAt;
    } else if (record.outcome === 'WRONG') {
      component.wrong += 1;
      component.beta += 1;
      component.halfLifeHours = clamp(component.halfLifeHours * 0.65, 2, 24 * 30);
      component.lastEvidenceAt = record.recordedAt;
      this.recordMisconception(record);
    }

    this.profile.concepts[record.knowledgeComponent] = component;
    this.persist();
  }

  buildReport(history: readonly AnswerRecord[], stats: SessionStats, now = Date.now()): LearnerReport {
    const concepts = Object.entries(this.profile.concepts).map(([name, state]) => {
      const mastery = state.alpha / (state.alpha + state.beta);
      const elapsedHours = state.lastEvidenceAt === null ? null : Math.max(0, now - state.lastEvidenceAt) / HOUR_MS;
      const retention = elapsedHours === null
        ? mastery
        : mastery * Math.pow(0.5, elapsedHours / state.halfLifeHours);
      return {
        component: name,
        category: state.category,
        attempts: state.correct + state.wrong,
        correct: state.correct,
        wrong: state.wrong,
        mastery: round(mastery),
        uncertainty: round(Math.min(1, 2 / Math.sqrt(state.alpha + state.beta))),
        retention: round(retention),
        halfLifeHours: round(state.halfLifeHours),
        hoursSinceLastEvidence: elapsedHours === null ? null : round(elapsedHours),
      };
    });

    const weakest = concepts
      .filter((concept) => concept.attempts > 0)
      .slice()
      .sort((a, b) => a.retention - b.retention || a.mastery - b.mastery)
      .slice(0, 4)
      .map((concept) => concept.component);
    const uncertain = concepts
      .filter((concept) => concept.attempts > 0)
      .slice()
      .sort((a, b) => b.uncertainty - a.uncertainty)
      .slice(0, 4)
      .map((concept) => concept.component);
    const due = concepts
      .filter((concept) => concept.attempts > 0 && concept.retention < RETENTION_THRESHOLD)
      .sort((a, b) => a.retention - b.retention)
      .slice(0, 5)
      .map((concept) => concept.component);

    const landed = history.filter((entry) => entry.outcome !== 'MISS');
    const early = landed.filter((entry) => entry.quality === 'EARLY').length;
    const motorNote = motorInterpretation(history.length, landed.length, early);

    return {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      sessionNumber: this.profile.sessionsCompleted + 1,
      game: {
        name: 'Punch English',
        format: 'four-lane rhythm boxing',
        sessionQuestions: stats.totalQuestions,
      },
      summary: {
        answered: stats.answered,
        correct: stats.correct,
        wrong: stats.wrong,
        missed: stats.missed,
        accuracy: round(stats.accuracy),
        averageReactionSeconds: round(stats.averageReaction),
      },
      punchKT: {
        concepts,
        weakestConcepts: weakest,
        uncertainConcepts: uncertain,
      },
      misconceptionEvidence: Object.values(this.profile.misconceptions)
        .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
        .slice(0, 8)
        .map((item) => ({
          component: item.component,
          label: item.label,
          count: item.count,
          lastSeenAt: new Date(item.lastSeenAt).toISOString(),
        })),
      forgettingAware: {
        dueConcepts: due,
        retentionThreshold: RETENTION_THRESHOLD,
      },
      motorEvidence: {
        landedPunchRate: history.length === 0 ? 0 : round(landed.length / history.length),
        earlyPunchRate: landed.length === 0 ? 0 : round(early / landed.length),
        averageReactionSeconds: round(stats.averageReaction),
        note: motorNote,
      },
      recentEvidence: history.slice(-20).map((entry) => ({
        component: entry.knowledgeComponent,
        category: entry.category,
        outcome: entry.outcome,
        selectedText: entry.selectedText,
        correctText: entry.correctText,
        misconception: entry.misconception,
        reactionTimeSeconds: round(entry.reactionTime),
        punchQuality: entry.quality,
      })),
    };
  }

  completeSession(): void {
    this.profile.sessionsCompleted += 1;
    this.persist();
  }

  private recordMisconception(record: AnswerRecord): void {
    if (!record.misconception) return;
    const key = `${record.knowledgeComponent}::${record.misconception}`;
    const existing = this.profile.misconceptions[key] ?? {
      component: record.knowledgeComponent,
      label: record.misconception,
      count: 0,
      lastSeenAt: record.recordedAt,
    };
    existing.count += 1;
    existing.lastSeenAt = record.recordedAt;
    this.profile.misconceptions[key] = existing;
  }

  private load(): StoredProfile {
    try {
      if (typeof localStorage === 'undefined') return emptyProfile();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyProfile();
      const parsed = JSON.parse(raw) as Partial<StoredProfile>;
      if (parsed.version !== 1 || !parsed.concepts || !parsed.misconceptions) return emptyProfile();
      return {
        version: 1,
        sessionsCompleted: Number.isFinite(parsed.sessionsCompleted) ? parsed.sessionsCompleted ?? 0 : 0,
        concepts: parsed.concepts,
        misconceptions: parsed.misconceptions,
      };
    } catch {
      return emptyProfile();
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
      }
    } catch {
      // Storage can be disabled; adaptation still works for the current tab.
    }
  }
}

function motorInterpretation(total: number, landed: number, early: number): string {
  if (total === 0) return 'No punch evidence was collected.';
  const missRate = 1 - landed / total;
  const earlyRate = landed === 0 ? 0 : early / landed;
  if (missRate >= 0.3) return 'Several blocks escaped; do not infer language weakness from those misses.';
  if (earlyRate >= 0.35) return 'Answer selection was often early; keep language and timing feedback separate.';
  return 'Punch control was stable enough for answer choices to be useful language evidence.';
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round = (value: number): number => Math.round(value * 1000) / 1000;
