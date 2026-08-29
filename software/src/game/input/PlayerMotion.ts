import {
  DIRECTION_DEADZONE,
  GUARD_ACTIVE_SECONDS,
  GUARD_COOLDOWN_SECONDS,
  HAND_REACH_DAMPING,
  HAND_RETURN_DAMPING,
  PLAYER_MOVE_DAMPING,
  PLAYER_MOVE_SPEED,
  SLOT_DIRECTIONS,
  STANCE_TOLERANCE,
  STANCE_X,
} from '../constants';
import type { MotionMode, MoveDirection, Stance } from '../types';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Frame-rate independent exponential approach. */
const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

/**
 * Where the player is standing, where their hand is reaching, and whether their
 * guard is up.
 *
 * Deliberately just numbers, normalised to -1..1, so a held key, a joystick, or
 * a webcam tracker reporting a chest position all drive the same model — the
 * gameplay core never asks *how* the player moved, only where they ended up.
 * That is the same trick `PunchEvent` plays for punches.
 *
 * Body and hand are two separate channels on purpose. Answering is done with
 * the feet; Word Connect is done with the hand alone, feet planted in the
 * centre. `mode` decides which one a generic movement signal steers, so a
 * device with a single stick works in both, while a device that tracks a chest
 * and a wrist separately can drive both at once.
 */
export class PlayerMotion {
  /** Body: -1 fully LEFT, 0 CENTER, +1 fully RIGHT. */
  x = 0;
  /** Hand, left/right. 0 is at rest by the chest. */
  handX = 0;
  /** Hand, down/up. 0 is at rest by the chest. */
  handY = 0;

  private currentMode: MotionMode = 'STANCE';
  private axisX = 0;
  private absoluteX: number | null = null;
  private reachX = 0;
  private reachY = 0;
  /** Latest simulation clock, so guard timing shares the gameplay clock. */
  private now = 0;
  private guardRaisedAt = Number.NEGATIVE_INFINITY;

  get mode(): MotionMode {
    return this.currentMode;
  }

  /**
   * Switch what movement steers. Entering `REACH` plants the feet dead centre
   * — during Word Connect the player *is* standing in the middle, whatever
   * they do — and drops the hand back to rest so the first letter costs a
   * deliberate reach.
   */
  setMode(mode: MotionMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    // The feet glide back to the middle rather than teleporting — the mini
    // game usually opens straight off an answer thrown from a side lane, and
    // the camera rides this.
    this.axisX = 0;
    this.absoluteX = 0;
    this.setReach(0, 0);
    this.handX = 0;
    this.handY = 0;
  }

  /**
   * Steering intent from a held key or a joystick, each -1..1. Routed to
   * whichever channel is live: the feet while answering, the hand while
   * connecting a word.
   */
  setAxis(x: number, y: number): void {
    if (this.currentMode === 'REACH') {
      this.setReach(x, y);
      return;
    }
    this.axisX = clamp(x, -1, 1);
  }

  /**
   * Body position from a source that knows where the player actually is — a
   * snap-to-lane key today, a pose tracker later. Any steering intent
   * immediately takes over again.
   *
   * Ignored in `REACH` mode: the feet do not move during Word Connect, so a
   * tracker can keep streaming a chest position without disturbing it.
   */
  setAbsolute(x: number | null): void {
    if (this.currentMode === 'REACH') return;
    this.absoluteX = x === null ? null : clamp(x, -1, 1);
  }

  /**
   * Where the hand is pointing, -1..1 per axis, (0, 0) meaning at rest. This is
   * the whole of the Word Connect control scheme, and the one signal an arm
   * tracker or an IMU glove can produce directly.
   */
  setReach(x: number, y: number): void {
    this.reachX = clamp(x, -1, 1);
    this.reachY = clamp(y, -1, 1);
  }

  snapTo(stance: Stance): void {
    this.setAbsolute(STANCE_X[stance]);
  }

  /** Advance the model. `now` is the simulation clock, in seconds. */
  update(dt: number, now: number): void {
    this.now = now;

    if (this.currentMode === 'STANCE') {
      this.x = stepBody(this.x, this.axisX, this.absoluteX, dt);
      if (this.axisX !== 0) this.absoluteX = null;
    } else {
      this.x = damp(this.x, 0, PLAYER_MOVE_DAMPING, dt);
    }

    this.handX = stepHand(this.handX, this.reachX, dt);
    this.handY = stepHand(this.handY, this.reachY, dt);
  }

  /** The lane the player is standing in, or null when between lanes. */
  get stance(): Stance | null {
    for (let lane = 0; lane < STANCE_X.length; lane += 1) {
      if (Math.abs(this.x - STANCE_X[lane]) <= STANCE_TOLERANCE) return lane as Stance;
    }
    return null;
  }

  /**
   * The lane the kart is in during the chase. Unlike `stance` this is never
   * null: a kart is always physically on some part of the road, and a row of
   * pictures arriving has to resolve against a lane whether or not the player
   * has settled into one.
   *
   * Answering is the opposite case on purpose — there the position *is* the
   * answer, so a punch thrown from the gap between two lanes has to stay a
   * miss rather than being rounded into a guess at the nearer one.
   */
  get lane(): Stance {
    let nearest: Stance = 0;
    let best = Infinity;
    for (let lane = 0; lane < STANCE_X.length; lane += 1) {
      const distance = Math.abs(this.x - STANCE_X[lane]);
      if (distance < best) {
        best = distance;
        nearest = lane as Stance;
      }
    }
    return nearest;
  }

  /** How solidly the player is in the current lane, 0..1. Drives the HUD. */
  get stanceStrength(): number {
    const lane = this.stance;
    if (lane === null) return 0;
    return 1 - Math.abs(this.x - STANCE_X[lane]) / STANCE_TOLERANCE;
  }

  /** Which way the hand is reaching, or null while it is still at rest. */
  get direction(): MoveDirection | null {
    return directionOf(this.handX, this.handY);
  }

  /** The same reach as a slot index, 0..3, or null. */
  get slotIndex(): number | null {
    return slotOf(this.handX, this.handY);
  }

  /** How far the arm is extended along its dominant axis, 0..1. Drives the HUD. */
  get reachStrength(): number {
    return clamp(Math.max(Math.abs(this.handX), Math.abs(this.handY)), 0, 1);
  }

  /**
   * Raise the guard. It holds for `GUARD_ACTIVE_SECONDS` and then drops on its
   * own, so blocking has to be timed against the monster's wind-up rather than
   * held from the moment it starts. The cooldown afterwards stops mashing the
   * key from covering the whole charge.
   *
   * @returns false when the guard is still up or still on cooldown.
   */
  raiseGuard(): boolean {
    if (this.now < this.guardRaisedAt + GUARD_ACTIVE_SECONDS + GUARD_COOLDOWN_SECONDS) {
      return false;
    }
    this.guardRaisedAt = this.now;
    return true;
  }

  /** True while the guard is actually up — this is what a blow is tested against. */
  isGuarding(at: number = this.now): boolean {
    return at >= this.guardRaisedAt && at - this.guardRaisedAt < GUARD_ACTIVE_SECONDS;
  }

  /** Seconds the guard has left before it drops. */
  get guardRemaining(): number {
    return Math.max(0, this.guardRaisedAt + GUARD_ACTIVE_SECONDS - this.now);
  }

  reset(): void {
    this.currentMode = 'STANCE';
    this.x = 0;
    this.handX = 0;
    this.handY = 0;
    this.axisX = 0;
    this.absoluteX = null;
    this.reachX = 0;
    this.reachY = 0;
    this.guardRaisedAt = Number.NEGATIVE_INFINITY;
  }
}

/** The dominant axis of a reach vector, or null while it is inside the deadzone. */
export function directionOf(x: number, y: number): MoveDirection | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (Math.max(ax, ay) < DIRECTION_DEADZONE) return null;
  if (ay >= ax) return y > 0 ? 'UP' : 'DOWN';
  return x > 0 ? 'RIGHT' : 'LEFT';
}

/** The same, as a word-connect slot index. */
export function slotOf(x: number, y: number): number | null {
  const direction = directionOf(x, y);
  if (direction === null) return null;
  const index = SLOT_DIRECTIONS.indexOf(direction);
  return index === -1 ? null : index;
}

/** Walking: a steering intent always wins over a stale absolute target. */
function stepBody(current: number, axis: number, absolute: number | null, dt: number): number {
  if (axis !== 0 || absolute === null) {
    return clamp(current + axis * PLAYER_MOVE_SPEED * dt, -1, 1);
  }
  return damp(current, absolute, PLAYER_MOVE_DAMPING, dt);
}

/**
 * Reaching: an arm is a spring, not a cart. It tracks the direction being
 * pushed rather than integrating toward it, so swinging from UP to LEFT is one
 * movement instead of two, and it falls back to guard on its own.
 */
function stepHand(current: number, target: number, dt: number): number {
  const lambda = target === 0 ? HAND_RETURN_DAMPING : HAND_REACH_DAMPING;
  return damp(current, target, lambda, dt);
}
