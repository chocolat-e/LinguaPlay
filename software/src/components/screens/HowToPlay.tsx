import { LANE_LABELS } from '../../game/constants';
import { game } from '../../game/instance';

const LANE_HINTS: Array<[string, string]> = [
  ['A', 'top left'],
  ['S', 'top right'],
  ['D', 'bottom left'],
  ['F', 'bottom right'],
];

export function HowToPlay() {
  return (
    <div className="layer layer--modal">
      <div className="panel howto">
        <h2 className="panel__title">How to play</h2>
        <p className="howto__lead">PUNCH THE CORRECT ANSWER</p>
        <p>
          A question appears and four answer blocks hold still while you read them. When
          the timer bar starts draining they advance on you — work out which answer is
          right and punch it just as it reaches you — the closer to your fist it lands,
          the bigger the timing bonus.
        </p>

        <div className="howto__grid">
          <div className="howto__card">
            <strong>Mouse</strong>
            <span>Click a block to punch it. Clicking empty space is a whiff.</span>
          </div>
          <div className="howto__card">
            <strong>Keyboard</strong>
            <span>A · S · D · F pick a lane. Space punches whatever you are hovering.</span>
          </div>
          <div className="howto__card">
            <strong>One hand</strong>
            <span>Every punch is thrown with the same fist — it reaches to whichever answer you pick.</span>
          </div>
          <div className="howto__card">
            <strong>Timing bonus</strong>
            <span>PERFECT +50 · GREAT +25 · GOOD +10 on top of the base 100 points.</span>
          </div>
          <div className="howto__card">
            <strong>Combo</strong>
            <span>3 in a row → 2× · 6 → 3× · 10 → 4×. One wrong answer breaks it.</span>
          </div>
          <div className="howto__card">
            <strong>Adaptive</strong>
            <span>Above 80% accuracy the questions get harder. Below 50% they ease off.</span>
          </div>
          <div className="howto__card">
            <strong>Session</strong>
            <span>20 questions or three minutes, whichever comes first.</span>
          </div>
        </div>

        <div className="lanes">
          {LANE_HINTS.map(([key, where], i) => (
            <div key={key} className="lanes__cell">
              <span className="lanes__letter">{LANE_LABELS[i]}</span>
              <kbd>{key}</kbd>
              <span>{where}</span>
            </div>
          ))}
        </div>

        <div className="results__actions">
          <button
            type="button"
            data-ui
            className="btn btn--primary"
            onClick={() => {
              game.uiSound();
              game.startCountdown();
            }}
          >
            Start punching
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
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
