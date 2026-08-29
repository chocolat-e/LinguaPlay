import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFENSE_PROMPT_SECONDS,
  MONSTER_CHARGE_SECONDS,
  WORD_CONNECT_SECONDS,
} from '../../game/constants';
import type { GameEvents } from '../../game/events';
import { game } from '../../game/instance';
import { useGameEvent } from '../../hooks/useGameEvent';
import { useCombat, useKartChase, useWordConnect } from '../../hooks/useGameState';

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

  const onChase = useCallback(
    (payload: GameEvents['kartChase']) => {
      if (payload.type === 'START') {
        // The topic gets the headline. "It's running" is the story; the topic
        // is the thing the player has to act on in the next two seconds.
        show(payload.topic, "IT'S RUNNING — drive through these, dodge the rest", 'special');
        return;
      }
      if (payload.type === 'CAUGHT') {
        show('RAMMED IT!', `Caught it · -${payload.damage} HP`, 'special');
        return;
      }
      if (payload.type === 'ESCAPED') {
        // Still worth something: every picture collected landed on it.
        if (payload.damage > 0) show('IT GOT AWAY', `Clipped it · -${payload.damage} HP`, 'bad');
        else show('IT GOT AWAY', 'Nothing collected', 'bad');
      }
    },
    [show],
  );
  useGameEvent('kartChase', onChase);

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
      <ChaseFlash />

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
      <KartChasePanel />
    </>
  );
}

/**
 * Speed, felt at the edges of the screen.
 *
 * Tunnel vision closing in with the rush, a green flare when ground is made up
 * and a red one on a crash. Read per frame from the simulation and written to
 * three CSS variables — the same rAF-not-React path the special attack's flash
 * uses, because none of these numbers can survive a round trip through a store.
 *
 * Rendered first and left at `z-index: 0` so it sits *behind* the chase panel
 * and the banners rather than washing them out.
 */
function ChaseFlash() {
  const flash = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let lastShown = false;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const node = flash.current;
      if (!node) return;

      const rush = game.chaseRush;
      const lurch = game.chaseLurch;
      const slam = game.chaseSlam;
      const shown = rush > 0.004 || lurch > 0.004 || slam > 0.004;
      if (shown !== lastShown) {
        lastShown = shown;
        node.style.display = shown ? 'block' : 'none';
      }
      if (!shown) return;

      node.style.setProperty('--rush', `${rush}`);
      // Squared, so a flare is a spike rather than a long smear.
      node.style.setProperty('--lurch', `${lurch * lurch}`);
      node.style.setProperty('--slam', `${slam * slam}`);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <div ref={flash} className="chase-flash" style={{ display: 'none' }} />;
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

/**
 * The chase read-out: what to drive through, and how much road is left between
 * the kart and the monster.
 *
 * The gap bar is the whole story — it fills toward the monster with every
 * picture collected and gives ground back on every crash, so the player can see
 * at a glance whether they are actually catching it.
 */
function KartChasePanel() {
  const chase = useKartChase();
  if (!chase.active) return null;

  const closed = 1 - chase.gap;
  const caught = chase.status === 'CAUGHT';
  const escaped = chase.status === 'ESCAPED';

  return (
    <div className={`kartgame${caught ? ' is-caught' : ''}${escaped ? ' is-escaped' : ''}`}>
      {/* The topic is the whole question of this mini game, so it is the whole
          panel. Everything else is a footnote under it. Keyed on the topic so
          the slam-in animation re-fires whenever a new chase starts. */}
      {/* Both rules of the mini game, above the one word they apply to. No
          article — topics are plural nouns and "drive through the music" is
          not a sentence anyone wants to read at speed. */}
      <p className="kartgame__eyebrow">DRIVE THROUGH · DODGE THE REST</p>
      <p key={chase.topic} className="kartgame__topic">
        {chase.topic}
      </p>

      <div className="kartgame__track">
        <span className="kartgame__fill" style={{ transform: `scaleX(${closed})` }} />
        {/* The kart rides the leading edge of the ground it has made up; the
            monster sits at the far end, waiting to be caught. */}
        <span className="kartgame__kart" style={{ left: `${closed * 100}%` }}>
          🛞
        </span>
        <span className="kartgame__prey">👾</span>
      </div>

      <p className="kartgame__footer">
        <span className="kartgame__status">
          {caught ? 'CAUGHT IT!' : escaped ? 'IT GOT AWAY' : 'CLOSING IN…'}
        </span>
        <span>
          <b>{chase.collected}</b> picked
          {chase.crashed > 0 && <b className="is-bad"> · {chase.crashed} crashed</b>}
        </span>
        <span>
          row {Math.min(chase.waveIndex + 1, chase.totalWaves)}/{chase.totalWaves}
        </span>
      </p>
    </div>
  );
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
