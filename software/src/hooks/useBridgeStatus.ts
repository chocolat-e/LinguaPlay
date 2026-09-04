import { useSyncExternalStore } from 'react';
import { bridge } from '../game/instance';
import type { BridgeStatus } from '../game/input';

/**
 * Whether the controller and the camera are currently feeding the game.
 *
 * Subscribed through `useSyncExternalStore` rather than mirrored into the
 * zustand snapshot: this changes on the timescale of someone plugging a device
 * in, and has nothing to do with the per-round state the snapshot carries.
 * `BridgeSource` already only notifies on an actual change, so a device sitting
 * connected costs no renders at all.
 */
export function useBridgeStatus(): BridgeStatus {
  return useSyncExternalStore(
    (onChange) => bridge.onStatus(onChange),
    () => bridge.status,
    () => bridge.status,
  );
}
