import { game } from '../../game/instance';
import { useCoach, useStats } from '../../hooks/useGameState';
import { formatNumber } from '../../utils/math';

interface Grade {
  letter: string;
  color: string;
  line: string;
}

function gradeFor(accuracy: number, answered: number): Grade {
  if (answered === 0) return { letter: '—', color: 'var(--muted)', line: 'No answers landed.' };
  if (accuracy >= 0.95) return { letter: 'S', color: 'var(--warm)', line: 'Flawless footwork.' };
  if (accuracy >= 0.85) return { letter: 'A', color: 'var(--correct)', line: 'Sharp and fast.' };
  if (accuracy >= 0.7) return { letter: 'B', color: 'var(--accent)', line: 'Solid round.' };
  if (accuracy >= 0.5) return { letter: 'C', color: 'var(--accent-soft)', line: 'Keep drilling.' };
  return { letter: 'D', color: 'var(--wrong)', line: 'Back to the gym.' };
}

export function ResultsScreen() {
  const stats = useStats();
  const coach = useCoach();
  const grade = gradeFor(stats.accuracy, stats.answered);
  const adaptivePackage = coach.package;
  const isPlanning = coach.status === 'loading';

  return (
    <div className="layer layer--modal">
      <div className="panel panel--results">
        <h2 className="panel__title">Round complete</h2>

        <div className="results__head">
          <div>
            <p className="eyebrow">Grade</p>
            <p className="results__grade" style={{ color: grade.color }}>
              {grade.letter}
            </p>
          </div>
          <div className="results__score">
            <p className="eyebrow">Final score</p>
            <div className="numeric">{formatNumber(stats.score)}</div>
            <p style={{ color: 'var(--muted)', margin: '0.3rem 0 0', fontSize: '0.85rem' }}>
              {grade.line}
            </p>
          </div>
        </div>

        <div className="results__grid">
          <Cell label="Accuracy" value={`${Math.round(stats.accuracy * 100)}%`} color="var(--accent)" />
          <Cell label="Best combo" value={`x${stats.bestCombo}`} color="var(--warm)" />
          <Cell label="Correct" value={String(stats.correct)} color="var(--correct)" />
          <Cell label="Wrong" value={String(stats.wrong)} color="var(--wrong)" />
          <Cell label="Missed" value={String(stats.missed)} color="var(--warm)" />
          <Cell
            label="Avg reaction"
            value={stats.answered ? `${stats.averageReaction.toFixed(2)}s` : '—'}
            color="var(--accent-soft)"
          />
        </div>

        <section className="coach" aria-live="polite" aria-busy={isPlanning}>
          <div className="coach__heading">
            <div>
              <p className="eyebrow">PunchKT coach</p>
              <h3>{isPlanning ? 'Planning your next level…' : adaptivePackage?.feedback.headline ?? 'Report ready'}</h3>
            </div>
            <span className={`coach__badge coach__badge--${adaptivePackage?.source ?? 'loading'}`}>
              {isPlanning ? 'Analysing' : adaptivePackage?.source === 'llm' ? 'AI planned' : 'Local plan'}
            </span>
          </div>

          {isPlanning ? (
            <p className="coach__loading">
              Separating English choices from punch timing, checking misconceptions and forgetting,
              then generating 30 validated questions.
            </p>
          ) : adaptivePackage ? (
            <>
              <div className="coach__diagnosis">
                <CoachList title="Working well" items={adaptivePackage.feedback.strengths} tone="good" />
                <CoachList title="Needs focus" items={adaptivePackage.feedback.weaknesses} tone="focus" />
              </div>
              <p className="coach__advice">{adaptivePackage.feedback.advice}</p>
              <div className="coach__curriculum">
                <span>Next: {adaptivePackage.curriculum.title}</span>
                {adaptivePackage.curriculum.targetConcepts.slice(0, 4).map((target) => (
                  <span className="coach__chip" key={target.component} title={target.reason}>
                    {target.component.replaceAll('-', ' ')}
                  </span>
                ))}
              </div>
              {coach.message && <p className="coach__message">{coach.message}</p>}
            </>
          ) : (
            <p className="coach__loading">The round is recorded. The standard question pool will continue.</p>
          )}
        </section>

        <div className="results__actions">
          <button
            type="button"
            data-ui
            className="btn btn--primary"
            autoFocus
            disabled={isPlanning}
            onClick={() => {
              game.uiSound();
              game.restart();
            }}
          >
            {isPlanning ? 'Building level…' : 'Play next level'}
          </button>
          <button
            type="button"
            data-ui
            className="btn btn--ghost"
            onClick={() => {
              game.uiSound();
              game.goToMenu();
            }}
          >
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

function CoachList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'good' | 'focus';
}) {
  return (
    <div className={`coach__list coach__list--${tone}`}>
      <p className="eyebrow">{title}</p>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="results__cell">
      <p className="eyebrow">{label}</p>
      <div className="numeric" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
