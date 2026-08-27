import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvents } from '../../game/events';
import { useGameEvent } from '../../hooks/useGameEvent';

interface Burst {
  key: number;
  headline: string;
  points: number;
  sub: string | null;
  good: boolean;
}

const PRAISE: Record<string, string> = {
  PERFECT: 'PERFECT!',
  GREAT: 'GREAT!',
  GOOD: 'NICE!',
  EARLY: 'GOOD!',
};

/**
 * The big slam of text in the middle of the screen after every punch, plus the
 * screen-wide colour flash. Mounted for ~900 ms, then removed.
 */
export function FeedbackBurst() {
  const [burst, setBurst] = useState<Burst | null>(null);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);

  const onResolved = useCallback((payload: GameEvents['resolved']) => {
    seq.current += 1;
    const good = payload.outcome === 'CORRECT';
    const headline = good
      ? PRAISE[payload.quality ?? 'GOOD'] ?? 'NICE!'
      : payload.outcome === 'WRONG'
        ? 'WRONG!'
        : 'MISS';

    const sub =
      good && payload.combo >= 3
        ? `COMBO ${payload.combo} · x${payload.multiplier}`
        : payload.outcome === 'WRONG'
          ? 'COMBO BREAK'
          : null;

    setBurst({ key: seq.current, headline, points: payload.points, sub, good });
  }, []);

  useGameEvent('resolved', onResolved);

  useEffect(() => {
    if (!burst) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBurst(null), 900);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [burst]);

  if (!burst) return null;

  return (
    <>
      <div key={`flash-${burst.key}`} className={`flash flash--${burst.good ? 'good' : 'bad'}`} />
      <div key={burst.key} className="feedback">
        <p className={`feedback__headline feedback__headline--${burst.good ? 'good' : 'bad'}`}>
          {burst.headline}
        </p>
        {burst.points !== 0 && (
          <p
            className="feedback__points"
            style={{ color: burst.points > 0 ? 'var(--correct)' : 'var(--wrong)' }}
          >
            {burst.points > 0 ? '+' : ''}
            {burst.points}
          </p>
        )}
        {burst.sub && <p className="feedback__sub">{burst.sub}</p>}
      </div>
    </>
  );
}

/** Announces adaptive difficulty changes so the player knows why it got harder. */
export function DifficultyToast() {
  const [message, setMessage] = useState<{ key: number; text: string } | null>(null);
  const seq = useRef(0);

  const onChange = useCallback((payload: GameEvents['difficulty']) => {
    seq.current += 1;
    setMessage({
      key: seq.current,
      text:
        payload.direction === 'up'
          ? `LEVEL UP · ${payload.to.toUpperCase()} QUESTIONS`
          : `EASING OFF · ${payload.to.toUpperCase()} QUESTIONS`,
    });
  }, []);

  useGameEvent('difficulty', onChange);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 2200);
    return () => window.clearTimeout(id);
  }, [message]);

  if (!message) return null;
  return (
    <div key={message.key} className="toast">
      {message.text}
    </div>
  );
}
