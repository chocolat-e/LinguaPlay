import { questionWindowSeconds } from '../../game/constants';
import { useCombat, useQuestion, useSettings, useStats } from '../../hooks/useGameState';

/**
 * The prompt itself lives in the DOM rather than the 3D scene: it has to stay
 * pin-sharp and perfectly readable at every resolution, which is exactly what
 * HTML text is good at.
 */
export function QuestionDisplay() {
  const question = useQuestion();
  const stats = useStats();
  const settings = useSettings();
  const combat = useCombat();

  // The mini games are combat moves, not questions — clear the top of the
  // screen so the letters above the player, and the incoming rows of pictures,
  // are actually visible.
  const answering =
    combat.phase !== 'WORD_CONNECT' &&
    combat.phase !== 'SPECIAL_ATTACK' &&
    combat.phase !== 'KART_CHASE';
  if (!question || !answering) return null;

  const window = questionWindowSeconds(question.difficulty, settings.speed);

  return (
    <div className="question">
      <div className="question__meta">
        <span className={`pill pill--${question.difficulty}`}>{question.difficulty}</span>
        <span className="pill">{question.category}</span>
        <span className="pill">
          Q {Math.min(stats.answered + 1, stats.totalQuestions)} / {stats.totalQuestions}
        </span>
      </div>
      <h2 key={question.id} className="question__text">
        {question.question}
      </h2>
      {/* Drains over exactly the time the player has before the blocks are
          out of reach. Pure CSS, so it costs no re-renders. */}
      <div className="question__timer">
        <span
          key={question.id}
          className="question__timer-fill"
          style={{ animationDuration: `${window}s` }}
        />
      </div>
    </div>
  );
}
