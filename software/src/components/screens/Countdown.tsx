import { useCallback, useState } from 'react';
import type { GameEvents } from '../../game/events';
import { useGameEvent } from '../../hooks/useGameEvent';

/** 3 · 2 · 1 · GO! — driven by countdown ticks from the simulation. */
export function Countdown() {
  const [value, setValue] = useState(3);
  const [seq, setSeq] = useState(0);

  const onTick = useCallback((payload: GameEvents['countdown']) => {
    setValue(payload.value);
    setSeq((n) => n + 1);
  }, []);
  useGameEvent('countdown', onTick);

  const isGo = value === 0;

  return (
    <div className="layer layer--modal countdown">
      <div>
        <div key={seq} className={`countdown__value ${isGo ? 'countdown__value--go' : ''}`}>
          {isGo ? 'GO!' : value}
        </div>
        <p className="countdown__brief">Punch the correct answer</p>
      </div>
    </div>
  );
}
