import { game } from '../../game/instance';
import { useTimeRemaining } from '../../hooks/useGameState';
import { formatTime } from '../../utils/math';
import { ComboDisplay } from './ComboDisplay';
import { Crosshair } from './Crosshair';
import { DifficultyToast, FeedbackBurst } from './FeedbackBurst';
import { QuestionDisplay } from './QuestionDisplay';
import { AccuracyDisplay, ScoreDisplay } from './ScoreDisplay';

function TimeDisplay() {
  const remaining = useTimeRemaining();
  return (
    <div className="stat stat--right">
      <p className="eyebrow">Time</p>
      <div className={`numeric stat__value stat__value--time ${remaining <= 10 ? 'is-low' : ''}`}>
        {formatTime(remaining)}
      </div>
    </div>
  );
}

/**
 * The in-game overlay.
 *
 * Score and combo hold the left gutter, time and accuracy the right, and the
 * whole centre column is left clear for the question and the incoming blocks.
 * Only the pause button accepts pointer input — everything else is
 * `pointer-events: none` so it can never swallow a punch.
 */
export function Hud() {
  return (
    <div className="layer">
      <div className="hud">
        <div className="hud__top">
          <div className="hud__left">
            <ScoreDisplay />
            <ComboDisplay />
          </div>
          <div />
          <div className="hud__right">
            <TimeDisplay />
            <AccuracyDisplay />
          </div>
        </div>

        <div />

        <div className="hud__bottom">
          <div className="hint">
            <span>
              <kbd>Click</kbd> punch
            </span>
            <span>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd>
              <kbd>F</kbd> answers
            </span>
            <span>
              <kbd>Space</kbd> punch aim
            </span>
            <span>
              <kbd>Esc</kbd> pause
            </span>
          </div>
        </div>
      </div>

      <QuestionDisplay />
      <FeedbackBurst />
      <DifficultyToast />
      <Crosshair />

      <button
        type="button"
        data-ui
        className="btn btn--icon"
        onClick={() => {
          game.uiSound();
          game.pause();
        }}
      >
        ‖ Pause
      </button>
    </div>
  );
}
