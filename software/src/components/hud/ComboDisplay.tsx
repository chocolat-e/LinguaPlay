import { useStats } from '../../hooks/useGameState';

/**
 * Combo counter. The combo value doubles as the React key, so every increment
 * remounts the span and replays the pop animation — no effect, no extra state.
 */
export function ComboDisplay() {
  const stats = useStats();

  if (stats.combo < 1) {
    return (
      <div className="stat">
        <p className="eyebrow">Combo</p>
        <div className="numeric stat__value" style={{ color: 'var(--muted)' }}>
          —
        </div>
      </div>
    );
  }

  return (
    <div className={`stat combo ${stats.multiplier > 1 ? 'is-hot' : ''}`}>
      <div>
        <p className="eyebrow">Combo</p>
        <span key={stats.combo} className="numeric combo__value combo__bump">
          x{stats.combo}
        </span>
      </div>
      <span className="combo__multiplier">{stats.multiplier}× PTS</span>
    </div>
  );
}
