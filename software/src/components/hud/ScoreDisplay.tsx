import { useStats } from '../../hooks/useGameState';
import { formatNumber } from '../../utils/math';

export function ScoreDisplay() {
  const stats = useStats();
  return (
    <div className="stat">
      <p className="eyebrow">Score</p>
      <div className="numeric stat__value stat__value--score">{formatNumber(stats.score)}</div>
    </div>
  );
}

export function AccuracyDisplay() {
  const stats = useStats();
  const percent = Math.round(stats.accuracy * 100);
  return (
    <div className="stat stat--right">
      <p className="eyebrow">Accuracy</p>
      <div className="numeric stat__value">{stats.answered === 0 ? '—' : `${percent}%`}</div>
    </div>
  );
}
