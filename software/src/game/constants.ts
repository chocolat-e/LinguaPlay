/** Tunable gameplay + layout constants. One place to rebalance the game. */

import type { Difficulty } from './types';

/** Lane order is A, B, C, D → top-left, top-right, bottom-left, bottom-right. */
export const LANE_LABELS = ['A', 'B', 'C', 'D'] as const;
export const LANE_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF'] as const;

/**
 * The game is one-handed: every punch, whichever lane it targets, is thrown
 * with this hand. Change it here and the glove, the animation, and every
 * `PunchEvent` follow.
 */
export const PLAYER_HAND: 'left' | 'right' = 'right';

export const LANE_X = [-2.45, 2.45, -2.45, 2.45];
export const LANE_Y = [3.0, 3.0, 0.78, 0.78];

export const TARGET_W = 4.3;
export const TARGET_H = 1.95;
export const TARGET_D = 0.5;

/**
 * Blocks enter from here, well down the tunnel, so the arrival still reads as
 * an approach.
 */
export const SPAWN_Z = -52;
/**
 * ...then rush up to this plane and hold, close enough that four answers are
 * comfortably readable. Reading happens near the player, not at the horizon —
 * that is the whole point of the read phase.
 */
export const READ_Z = -10;
/** The plane where a punch scores PERFECT. */
export const STRIKE_Z = 0;
/** Past this the target has flown by and the question is missed. */
export const DESPAWN_Z = 6.2;

/** The environment tunnel runs far deeper than the play area, for depth. */
export const TUNNEL_START_Z = -120;

export const CAMERA_POS: [number, number, number] = [0, 1.9, 9.5];
export const CAMERA_FOV = 45;

/** Seconds for the entry rush, SPAWN_Z → READ_Z. */
export const ENTRY_TIME = 0.55;

/**
 * Seconds the blocks hold still at READ_Z so the player can actually read four
 * answers before anything closes in. This is the "time to think" budget.
 */
export const READ_TIME = { easy: 2.0, medium: 1.5, hard: 1.0 } as const;

/** Seconds a target takes to travel READ_Z → STRIKE_Z, after the read phase. */
export const APPROACH_TIME = { easy: 2.6, medium: 2.1, hard: 1.7 } as const;

/**
 * |z - STRIKE_Z| windows for hit grading. Tight enough that punching during
 * the read phase earns no timing bonus — patience is what pays.
 */
export const HIT_WINDOW = { PERFECT: 2.2, GREAT: 5.0, GOOD: 8.0 } as const;

export const SCORE_BASE = 100;
export const QUALITY_BONUS = { PERFECT: 50, GREAT: 25, GOOD: 10, EARLY: 0 } as const;
export const WRONG_PENALTY = 50;

/** Combo → score multiplier thresholds, highest first. */
export const MULTIPLIER_TIERS: Array<{ minCombo: number; multiplier: number }> = [
  { minCombo: 10, multiplier: 4 },
  { minCombo: 6, multiplier: 3 },
  { minCombo: 3, multiplier: 2 },
  { minCombo: 0, multiplier: 1 },
];

export const SESSION_SECONDS = 180;
export const SESSION_QUESTIONS = 20;

/** Pause between a question resolving and the next one spawning. */
export const RESOLVE_DELAY = 0.9;
export const COUNTDOWN_SECONDS = 4; // 3 · 2 · 1 · GO!
export const GAME_OVER_SECONDS = 1.8;

export const MUSIC_BPM = 126;

/**
 * Total seconds a player has on a question, from the blocks appearing to the
 * last moment they can still be punched. Drives the on-screen timer bar.
 */
export function questionWindowSeconds(difficulty: Difficulty, speedSetting: number): number {
  const approach = APPROACH_TIME[difficulty] / Math.max(0.4, speedSetting);
  const speed = (STRIKE_Z - READ_Z) / approach;
  const postStrike = (DESPAWN_Z - STRIKE_Z) / speed;
  return ENTRY_TIME + READ_TIME[difficulty] + approach + postStrike;
}

/**
 * A deliberately restrained palette: one cool accent carries the interface,
 * and colour is reserved for meaning — green is right, red is wrong, amber is
 * a hot streak. Answer blocks are all the same colour so the player reads the
 * letter and the words, not a rainbow.
 */
export const COLORS = {
  accent: '#4cc9f0',
  accentSoft: '#8fd7f0',
  accentDeep: '#1b6d8f',
  correct: '#5ee08a',
  wrong: '#f2555a',
  warm: '#f5a524',
  grid: '#2b4a70',
  gridFar: '#131b2e',
} as const;

/** Every lane shares one colour — the letter badge is what tells them apart. */
export const LANE_COLORS = [COLORS.accent, COLORS.accent, COLORS.accent, COLORS.accent];
