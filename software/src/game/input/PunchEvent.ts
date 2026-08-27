/**
 * The single contract between *any* input device and the gameplay core.
 *
 * Today a mouse click or a key press produces one of these. Tomorrow a
 * MediaPipe hand tracker or an ESP32 + IMU streaming over WebSocket can
 * produce the exact same object, and `GameManager` needs no changes.
 */
export type PunchSource =
  | 'mouse'
  | 'keyboard'
  | 'touch'
  | 'motion' // webcam / MediaPipe pose estimation
  | 'device'; // ESP32, IMU, accelerometer/gyroscope over WS or BLE

export type Hand = 'left' | 'right' | 'unknown';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PunchEvent {
  /**
   * Which answer lane the punch is aimed at (0..3), or `null` for a raw punch
   * with no explicit target — the game then resolves it from where the player
   * is currently aiming. Motion controllers will typically send `null` plus a
   * `direction`, and the game maps direction → lane.
   */
  laneIndex: number | null;
  /** Unit-ish vector of travel, in player space. +x right, +y up, -z forward. */
  direction: Vec3;
  hand: Hand;
  /** performance.now() at the moment the punch was detected. */
  timestamp: number;
  /** 0..1 — how sure the source is that this was a real punch. */
  confidence: number;
  /** Normalised strike strength, 0..1. Drives impact FX intensity. */
  power: number;
  source: PunchSource;
}

const ZERO: Vec3 = { x: 0, y: 0, z: -1 };

export function createPunchEvent(partial: Partial<PunchEvent> = {}): PunchEvent {
  return {
    laneIndex: null,
    direction: ZERO,
    hand: 'right',
    timestamp: performance.now(),
    confidence: 1,
    power: 1,
    source: 'mouse',
    ...partial,
  };
}
