import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFENSE_PROMPT_SECONDS,
  MONSTER_CHARGE_SECONDS,
  WORD_CONNECT_SECONDS,
} from '../../game/constants';
import type { GameEvents } from '../../game/events';
import { game } from '../../game/instance';
import { useGameEvent } from '../../hooks/useGameEvent';
import { useCombat, useWordConnect } from '../../hooks/useGameState';

interface Banner {
  key: number;
  text: string;
  sub: string | null;
  tone: 'good' | 'bad' | 'special';
}

/**
 * Everything the battle needs to say in the middle of the screen: the monster's
 * wind-up, the call to defend, and how it turned out.
 *
 * The wind-up number comes from the throttled combat snapshot; the banners are
 * event-driven and unmount themselves, exactly like `FeedbackBurst`.
 */
export function CombatOverlay() {
  const combat = useCombat();
  const [banner, setBanner] = useState<Banner | null>(null);
  const seq = useRef(0);

  const show = useCallback((text: string, sub: string | null, tone: Banner['tone']) => {
    seq.current += 1;
    setBanner({ key: seq.current, text, sub, tone });
  }, []);

  const onDefense = useCallback(
    (payload: GameEvents['defense']) => {
      if (payload.blocked) show('BLOCKED!', 'No damage taken', 'good');
      else show('HIT!', `-${payload.damage} HP`, 'bad');
    },
    [show],
  );
  useGameEvent('defense', onDefense);

  const onSpecial = useCallback(
    (payload: GameEvents['special']) => {
      if (payload.damage <= 0) {
        show('NO CHARGE', 'Connect a word next time', 'bad');
        return;
      }
      show('SPECIAL ATTACK', `${payload.wordsCompleted} words · -${payload.damage} HP`, 'special');
    },
    [show],
  );
  useGameEvent('special', onSpecial);

  useEffect(() => {
    if (!banner) return;
    // The special attack announces itself before the blow lands, so its
    // banner has to outlast the wind-up and the barrage under it.
    const hold = banner.tone === 'special' ? 2600 : 1100;
    const id = window.setTimeout(() => setBanner(null), hold);
    return () => window.clearTimeout(id);
  }, [banner]);

  const charging = combat.chargeRemaining !== null;
  const remaining = combat.chargeRemaining ?? 0;
  const urgent = charging && remaining <= DEFENSE_PROMPT_SECONDS;

  return (
    <>
      {charging && (
        <div className={`charge${urgent ? ' charge--urgent' : ''}`}>
          <p className="charge__title">INCOMING ATTACK</p>
          <p className="charge__value numeric">{remaining.toFixed(1)}</p>
          <div className="charge__bar">
            <span
              className="charge__bar-fill"
              style={{ transform: `scaleX(${remaining / MONSTER_CHARGE_SECONDS})` }}
            />
          </div>
          <p className={`charge__prompt${urgent ? ' is-live' : ''}`}>
            {urgent ? 'DEFEND NOW' : 'Hold your nerve…'} · <kbd>Shift</kbd>
          </p>
        </div>
      )}

      {combat.guarding && <div className="guard-frame" />}

      <SpecialFlash />

      {banner && (
        <div key={banner.key} className={`banner banner--${banner.tone}`}>
          <p className="banner__text">{banner.text}</p>
          {banner.sub && <p className="banner__sub">{banner.sub}</p>}
        </div>
      )}

      <WordConnectPanel />
    </>
  );
}

/**
 * The screen-wide bloom of a special attack.
 *
 * Read straight off the simulation in a rAF loop and written to one style
 * property, like the crosshair and the stance marker — a flash that has to
 * track a per-frame value is exactly the thing React must not be doing.
 */
function SpecialFlash() {
  const flash = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let lastShown = false;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const node = flash.current;
      if (!node) return;

      const charge = game.specialCharge;
      const blast = game.specialBlast;
      const shown = charge > 0.002 || blast > 0.002;
      if (shown !== lastShown) {
        lastShown = shown;
        node.style.display = shown ? 'block' : 'none';
      }
      if (!shown) return;

      // Squared, so the barrage only glows and the finisher really flashes.
      node.style.opacity = `${Math.min(1, blast * blast * 0.72)}`;
      // The charge closes a dark iris in from the edges; the blast blows it
      // open again in white.
      node.style.setProperty('--charge', `${charge}`);
      node.style.setProperty('--blast', `${blast}`);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <div ref={flash} className="special-flash" style={{ display: 'none' }} />;
}

/** The mini game's own read-out: the word so far, and the time left on it. */
function WordConnectPanel() {
  const word = useWordConnect();
  if (!word.active) return null;

  const letters = [...word.word];
  const failed = word.status === 'FAILED';
  const complete = word.status === 'COMPLETE';

  return (
    <div className="wordgame">
      <div className="wordgame__row">
        <p className="wordgame__title">
          SPECIAL
          <b>
            {Math.min(word.wordIndex + 1, word.totalWords)}/{word.totalWords}
          </b>
        </p>
        <div
          className={`wordgame__letters${failed ? ' is-failed' : ''}${complete ? ' is-complete' : ''}`}
        >
          {letters.map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className={`wordgame__letter${index < word.progress ? ' is-done' : ''}${
                index === word.progress && !failed && !complete ? ' is-next' : ''
              }`}
            >
              {index < word.progress || failed || complete ? letter : '?'}
            </span>
          ))}
        </div>
        <p className="wordgame__hint">
          {failed ? 'MISSED' : complete ? 'CONNECTED!' : `${word.wordsCompleted} banked`}
        </p>
      </div>
      <div className="wordgame__timer">
        <span
          className="wordgame__timer-fill"
          style={{
            transform: `scaleX(${Math.max(0, word.timeRemaining) / WORD_CONNECT_SECONDS})`,
          }}
        />
      </div>
    </div>
  );
}
