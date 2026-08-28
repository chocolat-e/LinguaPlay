import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvents } from '../../game/events';
import { useGameEvent } from '../../hooks/useGameEvent';
import { useCombat } from '../../hooks/useGameState';

interface DamageNumber {
  key: number;
  amount: number;
  special: boolean;
}

/**
 * The two health bars that turn the quiz into a fight: the monster's across the
 * top, the player's beside their own stats.
 *
 * Both repaint only when a snapshot lands — the bar widths are plain inline
 * styles, and the CSS transition does the animating.
 */
export function MonsterHealth() {
  const combat = useCombat();
  const [numbers, setNumbers] = useState<DamageNumber[]>([]);
  const seq = useRef(0);

  const onDamage = useCallback((payload: GameEvents['monsterDamage']) => {
    if (payload.amount <= 0) return;
    seq.current += 1;
    const entry = { key: seq.current, amount: payload.amount, special: payload.special };
    setNumbers((current) => [...current, entry]);
  }, []);
  useGameEvent('monsterDamage', onDamage);

  // Damage numbers float for a moment and then leave.
  useEffect(() => {
    if (numbers.length === 0) return;
    const id = window.setTimeout(() => setNumbers((current) => current.slice(1)), 900);
    return () => window.clearTimeout(id);
  }, [numbers]);

  const fraction = combat.monsterMaxHp === 0 ? 0 : combat.monsterHp / combat.monsterMaxHp;
  const state = combat.monsterHp <= 0 ? 'down' : fraction <= 0.25 ? 'low' : 'ok';

  return (
    <div className="boss">
      <div className="boss__label">
        <span className="boss__name">Grammaton</span>
        <span className={`pill ${combat.diagnostic ? 'pill--easy' : 'pill--hard'}`}>
          Level {combat.level}
          {combat.diagnostic ? ' · warm-up' : ''}
        </span>
        <span className="boss__hp numeric">
          {Math.max(0, combat.monsterHp)} / {combat.monsterMaxHp}
        </span>
      </div>
      <div className="bar bar--boss">
        <span
          className={`bar__fill bar__fill--boss is-${state}`}
          style={{ transform: `scaleX(${Math.max(0, fraction)})` }}
        />
      </div>
      <div className="boss__numbers">
        {numbers.map((entry) => (
          <span
            key={entry.key}
            className={`damage${entry.special ? ' damage--special' : ''}`}
          >
            -{entry.amount}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Player health, plus how close the next special attack is. */
export function PlayerHealth() {
  const combat = useCombat();
  const fraction = combat.playerMaxHp === 0 ? 0 : combat.playerHp / combat.playerMaxHp;
  const low = fraction <= 0.3;

  return (
    <div className="stat player-hp">
      <p className="eyebrow">Health</p>
      <div className="bar bar--player">
        <span
          className={`bar__fill bar__fill--player ${low ? 'is-low' : ''}`}
          style={{ transform: `scaleX(${Math.max(0, fraction)})` }}
        />
      </div>
      <div className="player-hp__row">
        <span className={`numeric player-hp__value ${low ? 'is-low' : ''}`}>
          {Math.max(0, combat.playerHp)}
        </span>
        <span className="player-hp__streak" title="Correct answers in a row">
          {Array.from({ length: combat.streakTarget }, (_, i) => (
            <i key={i} className={i < combat.correctStreak ? 'is-lit' : ''} />
          ))}
        </span>
      </div>
    </div>
  );
}
