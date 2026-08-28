import { game } from '../../game/instance';
import { useTimeRemaining } from '../../hooks/useGameState';
import { formatTime } from '../../utils/math';
import { CombatOverlay } from './CombatOverlay';
import { ComboDisplay } from './ComboDisplay';
import { Crosshair } from './Crosshair';
import { DifficultyToast, FeedbackBurst } from './FeedbackBurst';
import { MonsterHealth, PlayerHealth } from './HealthBars';
import { QuestionDisplay } from './QuestionDisplay';
import { AccuracyDisplay, ScoreDisplay } from './ScoreDisplay';
import { StanceIndicator } from './StanceIndicator';

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
 * Score, combo and health hold the left gutter, time and accuracy the right,
 * the monster's health bar spans the top, and the whole centre column is left
 * clear for the question and the incoming blocks. Only the pause button accepts
 * pointer input — everything else is `pointer-events: none` so it can never
 * swallow a punch.
 */
export function Hud() {
  return (
    <div className="layer">
      <div className="hud">
        <div className="hud__top">
          <div className="hud__left">
            <ScoreDisplay />
            <ComboDisplay />
            <PlayerHealth />
          </div>
          <div />
          <div className="hud__right">
            <TimeDisplay />
            <AccuracyDisplay />
          </div>
        </div>

        <div />

        <div className="hud__bottom">
          <StanceIndicator />
          <div className="hint">
            <span>
              <kbd>←</kbd>
              <kbd>→</kbd> move
            </span>
            <span>
              <kbd>1</kbd>
              <kbd>2</kbd>
              <kbd>3</kbd> jump to lane
            </span>
            <span>
              <kbd>Space</kbd> punch
            </span>
            <span>
              <kbd>Shift</kbd> defend
            </span>
            <span>
              <kbd>Esc</kbd> pause
            </span>
          </div>
        </div>
      </div>

      <MonsterHealth />
      <QuestionDisplay />
      <CombatOverlay />
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
