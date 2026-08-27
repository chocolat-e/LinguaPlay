import { useEffect } from 'react';
import type { GameEvents } from '../game/events';
import { game } from '../game/instance';

/**
 * Subscribe to a gameplay event for the lifetime of a component.
 * The handler is read from a ref-free closure, so pass a stable callback or
 * accept that re-subscribing on change is cheap (it is — a Set add/delete).
 */
export function useGameEvent<K extends keyof GameEvents>(
  type: K,
  handler: (payload: GameEvents[K]) => void,
): void {
  useEffect(() => game.bus.on(type, handler), [type, handler]);
}
