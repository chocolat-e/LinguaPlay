/** Tunable gameplay + layout constants. One place to rebalance the game. */

import type { Difficulty } from './types';

/**
 * Answers per question, one per standing position. Authored and coach-generated
 * items still carry four options; `QuestionManager` trims each one down to
 * these three lanes, so the question data and the LLM contract never had to
 * change shape.
 */
export const ANSWER_CHOICES = 3;

/** Lane order is L, C, R — the three positions the player can stand in. */
export const LANE_LABELS = ['L', 'C', 'R'] as const;
export const LANE_NAMES = ['LEFT', 'CENTER', 'RIGHT'] as const;
/** Tap-to-move shortcuts. Holding ← / → (or A / D) moves continuously instead. */
export const LANE_KEYS = ['Digit1', 'Digit2', 'Digit3'] as const;

/**
 * The game is one-handed: every punch, whichever lane it targets, is thrown
 * with this hand. Change it here and the glove, the animation, and every
 * `PunchEvent` follow.
 */
export const PLAYER_HAND: 'left' | 'right' = 'right';

export const LANE_X = [-4.0, 0, 4.0];
export const LANE_Y = [2.0, 2.0, 2.0];

export const TARGET_W = 3.7;
export const TARGET_H = 1.7;
export const TARGET_D = 0.5;

/**
 * Blocks enter from here, well down the tunnel, so the arrival still reads as
 * an approach.
 */
export const SPAWN_Z = -52;
/**
 * ...then rush up to this plane and hold, close enough that three answers are
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
 * Seconds the blocks hold still at READ_Z so the player can actually read the
 * answers — and walk to one — before anything closes in. This is the "time to
 * think" budget, and now also the time to move.
 */
export const READ_TIME = { easy: 2.4, medium: 1.9, hard: 1.4 } as const;

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

/** Rounds now contain combat interludes, so they get a little more room. */
export const SESSION_SECONDS = 210;
export const SESSION_QUESTIONS = 20;

// ------------------------------------------------------------- movement --

/**
 * The player's position is a normalised axis: -1 is fully LEFT, 0 is CENTER,
 * +1 is fully RIGHT. Keeping it normalised means a keyboard, a joystick, or a
 * webcam tracker reporting a chest position all feed the same number.
 */
export const STANCE_X = [-1, 0, 1] as const;

/**
 * How close to a lane centre counts as "standing in it". Forgiving enough that
 * nobody needs pixel-perfect alignment, tight enough that the gaps between
 * lanes are real — a punch thrown from a gap is a MISS, never a guess at the
 * nearest answer.
 */
export const STANCE_TOLERANCE = 0.42;

/** Normalised units per second while a movement key is held. */
export const PLAYER_MOVE_SPEED = 2.7;
/** How fast the player converges on an absolute position (snap keys, tracker). */
export const PLAYER_MOVE_DAMPING = 16;
/** World-space camera offset at |x| = 1, so moving is visible in the scene. */
export const PLAYER_LANE_WORLD_X = 1.2;

/**
 * The hand is a second, separate axis pair: -1..1 left/right and down/up, with
 * (0, 0) meaning "at rest by the chest". Word Connect is aimed entirely with
 * this — the feet stay planted in the centre — so a glove only ever has to
 * report where the arm is pointing.
 */
/** Past this on the dominant axis, the hand is reaching at a word-connect slot. */
export const DIRECTION_DEADZONE = 0.45;
/** How fast the arm extends toward the direction being pushed. */
export const HAND_REACH_DAMPING = 15;
/** How fast it drops back to guard once nothing is pushing it. Slower than the
 *  reach, so a quick jab-and-punch is not punished by a hair-trigger recentre. */
export const HAND_RETURN_DAMPING = 3.2;

// --------------------------------------------------------------- combat --

/** Level 1 is a diagnostic round: the monster never strikes back. */
export const DIAGNOSTIC_LEVEL = 1;

export const MONSTER_MAX_HP = 380;
/** Where the monster floats, down the tunnel behind the answer blocks. */
export const MONSTER_Z = -24;
export const MONSTER_Y = 5.4;

export const MONSTER_DAMAGE_BASE = 16;
/** Cleaner punches hurt more, on top of the base. */
export const MONSTER_DAMAGE_QUALITY = { PERFECT: 12, GREAT: 7, GOOD: 3, EARLY: 0 } as const;
export const MONSTER_DAMAGE_COMBO_STEP = 2;
export const MONSTER_DAMAGE_COMBO_CAP = 14;

export const PLAYER_MAX_HP = 100;
export const PLAYER_HIT_DAMAGE = 20;

/** Seconds the monster winds up before the blow lands. */
export const MONSTER_CHARGE_SECONDS = 2.4;
/** Seconds the strike animation holds after the hit has been resolved. */
export const MONSTER_STRIKE_SECONDS = 0.75;
/** Beat after the strike before the next question spawns. */
export const MONSTER_RECOVER_SECONDS = 0.55;
/** Once the wind-up drops below this, the DEFEND prompt appears. */
export const DEFENSE_PROMPT_SECONDS = 1.1;

/**
 * A raised guard holds for this long and then drops on its own. That is what
 * stops "hold block from the start of the charge" being a free pass: the guard
 * has to go up inside the last GUARD_ACTIVE_SECONDS of the wind-up.
 */
export const GUARD_ACTIVE_SECONDS = 0.8;
/** Dead time after a guard drops, so mashing the key is not a free pass either. */
export const GUARD_COOLDOWN_SECONDS = 0.55;

// --------------------------------------------------------- word connect --

/** Correct answers in a row that earn the special attack. */
export const WORD_CONNECT_STREAK = 5;
/** Puzzle words are never longer than this. */
export const WORD_CONNECT_MAX_LETTERS = 4;
export const WORD_CONNECT_MIN_LETTERS = 3;
export const WORD_CONNECT_WORDS = 3;
export const WORD_CONNECT_SECONDS = 5.5;
/** Hold on a finished word long enough for the player to read the result. */
export const WORD_CONNECT_GAP = 0.7;
/**
 * The special attack is a sequence, not a single frame — a wind-up the player
 * can feel coming, a barrage, then one finishing blow. Every stage below is a
 * beat of that, and the whole point is that the payoff for five correct
 * answers in a row should not look like an ordinary punch.
 */
export const SPECIAL_WINDUP_SECONDS = 0.85;
/** Cadence of the barrage. Fast enough to read as one continuous assault. */
export const SPECIAL_HIT_INTERVAL = 0.11;
/** Blows in the barrage per word connected — more words, longer assault. */
export const SPECIAL_HITS_PER_WORD = 3;
/** The share of the damage held back for the last blow. */
export const SPECIAL_FINISHER_SHARE = 0.45;
/** How long the finisher rings out before the next question. */
export const SPECIAL_FINISH_SECONDS = 1.6;
/** Time crawls as the finisher lands, in real seconds. */
export const SPECIAL_SLOWMO_SECONDS = 0.34;
export const SPECIAL_SLOWMO_SCALE = 0.3;

/** Damage by words completed: index 0 is none, then 1, 2, and 3+. */
export const SPECIAL_DAMAGE_BY_WORDS = [0, 34, 66, 108];
/** Every word beyond that table adds this much. */
export const SPECIAL_DAMAGE_EXTRA_WORD = 34;
/** Score awarded per point of special-attack damage. */
export const SPECIAL_SCORE_PER_DAMAGE = 6;

/**
 * Word-connect slots, in the order UP · RIGHT · DOWN · LEFT.
 *
 * Kept inside the camera frustum at SLOT_Z, and clear of the HUD panels — the
 * player has to be able to see every letter to plan the route through them.
 */
export const SLOT_DIRECTIONS = ['UP', 'RIGHT', 'DOWN', 'LEFT'] as const;
export const SLOT_X = [0, 5.6, 0, -5.6];
export const SLOT_Y = [4.0, 1.4, -1.2, 1.4];
export const SLOT_Z = -2.5;

// ----------------------------------------------------------- kart chase --

/**
 * Monster health fractions that make it break and run, in the order they are
 * crossed. Each one buys exactly one chase, so a fight has at most two — enough
 * that the chase reads as a turning point in the battle rather than a level.
 */
export const KART_CHASE_HP_TRIGGERS = [0.6, 0.3] as const;

/** Rows of pictures in one chase. */
export const KART_WAVES = 8;
/**
 * Net pictures needed to run the monster down. One row can only ever be worth
 * one, so this is "get most of them right" — and a crash gives one back.
 */
export const KART_CATCH_TARGET = 5;
export const KART_CRASH_COST = 1;

/** Rows enter from further back than the answer blocks: they arrive at speed. */
export const KART_SPAWN_Z = -68;
/**
 * ...and stop well short of the camera. An answer block is allowed to fly right
 * past the player because there is only ever one row of them; a chase has rows
 * going by constantly, and a 2.5-unit card three units from the lens fills the
 * whole screen. This is where a row is done.
 */
export const KART_DESPAWN_Z = 2.4;
/**
 * World units per second, before the speed setting scales it.
 *
 * Paired with a deep `KART_SPAWN_Z`, this gives roughly three seconds from a
 * row appearing to it arriving — recognising a picture and deciding whether it
 * belongs to the topic is a reading task, and rushing it just makes the round
 * a coin flip. The *sense* of speed comes from the tunnel and the lens, which
 * is why this can be calm without the chase feeling slow.
 */
export const KART_BLOCK_SPEED = 24;
/** Seconds between rows. Long enough that rows never bunch up on each other. */
export const KART_WAVE_INTERVAL = 1.6;
/** A beat to read the topic before the first row appears. */
export const KART_LEAD_IN = 1.2;
/** ...and one after the last row resolves, before the hit lands. */
export const KART_TAIL = 0.9;

/**
 * The chase runs on wider lanes than the answer game.
 *
 * Three cards on the answer game's ±4 spacing very nearly touch once they are
 * close, and telling them apart at a glance is the whole task here. Steering is
 * untouched — the player still moves between lanes 0/1/2 — this only decides
 * where the pictures sit.
 */
export const KART_LANE_X = [-5.6, 0, 5.6];
export const KART_BLOCK_Y = 1.9;
export const KART_BLOCK_SIZE = 3.0;
/** Where the lane guides are painted, just clear of the tunnel floor. */
export const KART_LANE_Y = -1.55;

// How the chase *looks*. None of this changes a rule: it is what the tunnel,
// the camera and the monster read to make the speed legible.

/** How far down the tunnel the monster runs while the gap is still wide. */
export const KART_FLEE_DISTANCE = 54;
/** ...and how far it swerves across the road as it runs. */
export const KART_FLEE_WEAVE = 4.2;
/** How quickly the world winds up into the chase, and coasts back out of it. */
export const KART_RUSH_ATTACK = 2.4;
export const KART_RUSH_RELEASE = 1.7;
/** How fast the camera hauls the monster in as ground is made up. */
export const KART_GAP_DAMPING = 4.5;

/** Damage per picture collected, and the bonus for actually catching it. */
export const KART_DAMAGE_PER_PICTURE = 9;
export const KART_RAM_DAMAGE = 46;
/** Score per picture collected. Never touches the accuracy counts. */
export const KART_SCORE_PER_PICTURE = 120;

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
 * letter and the words, not a rainbow. The monster gets the one extra hue,
 * because it is the one thing on screen that is not part of the interface.
 */
export const COLORS = {
  accent: '#4cc9f0',
  accentSoft: '#8fd7f0',
  accentDeep: '#1b6d8f',
  correct: '#5ee08a',
  wrong: '#f2555a',
  warm: '#f5a524',
  monster: '#a855f7',
  grid: '#2b4a70',
  gridFar: '#131b2e',
} as const;

/** Every lane shares one colour — the letter badge is what tells them apart. */
export const LANE_COLORS = [COLORS.accent, COLORS.accent, COLORS.accent];
