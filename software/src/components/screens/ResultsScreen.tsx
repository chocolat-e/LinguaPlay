import { game } from '../../game/instance';
import { useCoach, useCombat, useReview, useStats } from '../../hooks/useGameState';
import type { ReviewItem, RoundOutcome } from '../../game/types';
import { formatNumber } from '../../utils/math';

interface Grade {
  letter: string;
  color: string;
  line: string;
}

/** How the fight itself ended, separately from how the English went. */
function battleTitle(outcome: RoundOutcome | null): { title: string; tone: string } {
  switch (outcome) {
    case 'VICTORY':
      return { title: 'Monster defeated', tone: 'var(--correct)' };
    case 'DEFEAT':
      return { title: 'You were knocked out', tone: 'var(--wrong)' };
    default:
      return { title: 'Round complete', tone: 'var(--accent)' };
  }
}

function gradeFor(accuracy: number, answered: number): Grade {
  if (answered === 0) return { letter: '—', color: 'var(--muted)', line: 'You did not answer any questions.' };
  if (accuracy >= 0.95) return { letter: 'S', color: 'var(--warm)', line: 'Flawless footwork.' };
  if (accuracy >= 0.85) return { letter: 'A', color: 'var(--correct)', line: 'Sharp and fast.' };
  if (accuracy >= 0.7) return { letter: 'B', color: 'var(--accent)', line: 'Solid round.' };
  if (accuracy >= 0.5) return { letter: 'C', color: 'var(--accent-soft)', line: 'Keep drilling.' };
  return { letter: 'D', color: 'var(--wrong)', line: 'Back to the gym.' };
}

export function ResultsScreen() {
  const stats = useStats();
  const coach = useCoach();
  const combat = useCombat();
  const review = useReview();
  const grade = gradeFor(stats.accuracy, stats.answered);
  const battle = battleTitle(combat.roundOutcome);
  const adaptivePackage = coach.package;
  const isPlanning = coach.status === 'loading';

  return (
    <div className="layer layer--modal">
      <div className="panel panel--results">
        <h2 className="panel__title" style={{ color: battle.tone }}>
          {battle.title}
        </h2>

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
          <Cell label="Ran out of time" value={String(stats.missed)} color="var(--warm)" />
          <Cell
            label="Average speed"
            value={stats.answered ? `${stats.averageReaction.toFixed(2)}s` : '—'}
            color="var(--accent-soft)"
          />
          <Cell
            label="Monster health left"
            value={`${Math.max(0, combat.monsterHp)} / ${combat.monsterMaxHp}`}
            color="var(--monster)"
          />
          <Cell
            label="Your health left"
            value={
              combat.diagnostic
                ? 'No damage taken'
                : `${Math.max(0, combat.playerHp)} / ${combat.playerMaxHp}`
            }
            color={combat.playerHp > 0 ? 'var(--correct)' : 'var(--wrong)'}
          />
          <Cell label="Level" value={String(combat.level)} color="var(--accent)" />
        </div>

        <ReviewSection items={review} answered={stats.answered} />

        <section className="coach" aria-live="polite" aria-busy={isPlanning}>
          <div className="coach__heading">
            <div>
              <p className="eyebrow">Your coach</p>
              <h3>{isPlanning ? 'Planning your next level…' : adaptivePackage?.feedback.headline ?? 'Your report is ready'}</h3>
            </div>
            <span className={`coach__badge coach__badge--${adaptivePackage?.source ?? 'loading'}`}>
              {isPlanning ? 'Reading your round' : adaptivePackage?.source === 'llm' ? 'Made for you' : 'Practice set'}
            </span>
          </div>

          {isPlanning ? (
            <p className="coach__loading">
              Looking at which questions you found hard, then building the next set of
              questions around them.
            </p>
          ) : adaptivePackage ? (
            <>
              <div className="coach__diagnosis">
                <CoachList title="Working well" items={adaptivePackage.feedback.strengths} tone="good" />
                <CoachList title="Needs focus" items={adaptivePackage.feedback.weaknesses} tone="focus" />
              </div>
              <p className="coach__advice">{adaptivePackage.feedback.advice}</p>
              <div className="coach__curriculum">
                <span>Next up: {adaptivePackage.curriculum.title}</span>
                {adaptivePackage.curriculum.targetConcepts.slice(0, 4).map((target) => (
                  <span className="coach__chip" key={target.component} title={target.reason}>
                    {target.component.replaceAll('-', ' ')}
                  </span>
                ))}
              </div>
              {coach.message && <p className="coach__message">{coach.message}</p>}
            </>
          ) : (
            <p className="coach__loading">Your round is saved. The next level is ready when you are.</p>
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

/**
 * The questions the player did not get right, each with the right answer and a
 * short reason. This is the part players actually learn from, so it sits above
 * the coach summary rather than below it.
 */
function ReviewSection({ items, answered }: { items: ReviewItem[]; answered: number }) {
  if (answered === 0) return null;

  if (items.length === 0) {
    return (
      <section className="review review--clean">
        <p className="eyebrow">Answers to go over</p>
        <p className="review__clean">
          Nothing to correct — you got every question right this round.
        </p>
      </section>
    );
  }

  return (
    <section className="review">
      <p className="eyebrow">
        Answers to go over ({items.length})
      </p>
      <ul className="review__list">
        {items.map((item, index) => (
          <li className="review__item" key={`${item.questionId}-${index}`}>
            <p className="review__question">{item.question}</p>
            <p className="review__answers">
              <span className="review__yours">
                You said: {item.yourAnswer ?? 'no answer in time'}
              </span>
              <span className="review__correct">Correct: {item.correctAnswer}</span>
            </p>
            <p className="review__why">{item.explanation}</p>
          </li>
        ))}
      </ul>
    </section>
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
