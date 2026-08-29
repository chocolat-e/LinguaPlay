import { LANE_LABELS, LANE_NAMES, WORD_CONNECT_STREAK } from '../../game/constants';
import { game } from '../../game/instance';

const LANE_HINTS: Array<[string, string]> = [
  ['1', 'walk left'],
  ['2', 'stand centre'],
  ['3', 'walk right'],
];

export function HowToPlay() {
  return (
    <div className="layer layer--modal">
      <div className="panel howto">
        <h2 className="panel__title">How to play</h2>
        <p className="howto__lead">MOVE TO THE ANSWER, THEN PUNCH</p>
        <p>
          A question appears and three answer blocks hold still while you read them —
          one on the left, one in the centre, one on the right. Walk to the answer you
          want, <em>then</em> throw the punch. A punch only counts for the answer you are
          actually standing in front of; swinging from anywhere else is a miss. Every
          correct answer lands on the monster. Every mistake gives it a turn.
        </p>

        <div className="howto__grid">
          <div className="howto__card">
            <strong>Move</strong>
            <span>← → or A · D to walk. 1 · 2 · 3 steps straight to a lane.</span>
          </div>
          <div className="howto__card">
            <strong>Punch</strong>
            <span>Space, or click the block you are standing in front of.</span>
          </div>
          <div className="howto__card">
            <strong>Defend</strong>
            <span>
              Shift raises your guard — but only briefly. Time it to the last moment of
              the monster's wind-up.
            </span>
          </div>
          <div className="howto__card">
            <strong>Level 1</strong>
            <span>A warm-up round. The monster is working out your level, and never hits back.</span>
          </div>
          <div className="howto__card">
            <strong>Level 2+</strong>
            <span>A wrong answer or a miss starts an attack. Fail to block and you lose health.</span>
          </div>
          <div className="howto__card">
            <strong>Special attack</strong>
            <span>
              {WORD_CONNECT_STREAK} correct in a row starts Word Connect — connect the
              letters in order for a heavy hit.
            </span>
          </div>
          <div className="howto__card">
            <strong>Word Connect: hand only</strong>
            <span>
              Your feet stay centred and there is no punch. Just reach ← ↑ → ↓ at a
              letter and it connects. Reach at the wrong one and the word is lost.
            </span>
          </div>
          <div className="howto__card">
            <strong>The chase</strong>
            <span>
              Hurt the monster enough and it runs. Steer your kart between the three
              lanes — tilt the controller, or use ← →. There is no punch here at all.
            </span>
          </div>
          <div className="howto__card">
            <strong>Chase: pictures</strong>
            <span>
              Rows of pictures come at you under one topic. Drive through the ones that
              belong to it, dodge the ones that do not. Close the gap and you ram it.
            </span>
          </div>
          <div className="howto__card">
            <strong>Timing bonus</strong>
            <span>PERFECT +50 · GREAT +25 · GOOD +10, and cleaner punches hurt more.</span>
          </div>
          <div className="howto__card">
            <strong>Combo</strong>
            <span>3 in a row → 2× · 6 → 3× · 10 → 4×. One wrong answer breaks it.</span>
          </div>
        </div>

        <div className="lanes">
          {LANE_HINTS.map(([key, where], i) => (
            <div key={key} className="lanes__cell">
              <span className="lanes__letter">{LANE_LABELS[i]}</span>
              <kbd>{key}</kbd>
              <span>
                {LANE_NAMES[i].toLowerCase()} · {where}
              </span>
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
