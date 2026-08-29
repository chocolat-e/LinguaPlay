import { LANE_KEYS } from '../constants';
import type { MoveDirection, Stance } from '../types';
import { PlayerMotion } from './PlayerMotion';
import { createPunchEvent, type PunchEvent } from './PunchEvent';

export type PunchListener = (event: PunchEvent) => void;
export type GuardListener = (raised: boolean) => void;

/**
 * The extra channels a device can drive besides punching: where the player is
 * standing, and whether they just raised their guard.
 *
 * Handed to `attach` as a second argument, so a source that only throws punches
 * — every source written before the battle mechanics existed — keeps working
 * without changes.
 */
export interface InputControls {
  /**
   * Steering intent, each -1..1. A keyboard or a joystick uses this.
   *
   * It drives whichever part of the player is currently in control: the feet
   * while answering, the hand during Word Connect. A device with one stick
   * therefore works in both without knowing which is running.
   */
  move(x: number, y: number): void;
  /**
   * Absolute normalised body position, -1 LEFT to +1 RIGHT. A pose tracker or
   * a snap key uses this. Ignored during Word Connect, where the feet are
   * planted in the centre.
   */
  moveTo(x: number | null): void;
  /**
   * Where the hand is pointing, -1..1 per axis, (0, 0) at rest. A glove or a
   * wrist landmark drives this directly; it is the whole Word Connect control
   * scheme, and it never moves the body.
   */
  reach(x: number, y: number): void;
  /** Raise the guard. Returns false if it is still on cooldown. */
  guard(): boolean;
}

/**
 * A device that can produce punches. Implement this to add hardware.
 * `emit` is handed in by the InputManager at attach time, along with the
 * movement/guard `controls` if the device drives those too.
 */
export interface InputSource {
  readonly id: string;
  attach(emit: PunchListener, controls: InputControls): void;
  detach(): void;
}

/**
 * Fans any number of `InputSource`s into a single stream of `PunchEvent`s, and
 * owns the one `PlayerMotion` model they all steer.
 *
 * The gameplay core subscribes once, here, and never learns whether the punch
 * came from a mouse, the keyboard, or a glove full of accelerometers.
 */
export class InputManager {
  /** Where the player is standing. Read by the sim, the scene, and the HUD. */
  readonly motion = new PlayerMotion();

  private sources = new Map<string, InputSource>();
  private listeners = new Set<PunchListener>();
  private guardListeners = new Set<GuardListener>();
  private enabled = true;
  /** Lane the pointer is hovering. Used for the hover highlight only. */
  private aimLane: number | null = null;

  private emit = (event: PunchEvent): void => {
    if (!this.enabled) return;
    // The lane a punch lands in is decided by the gameplay core from the
    // player's standing position — never substituted in here, or "punch from
    // the wrong place" could not be told apart from a deliberate answer.
    for (const listener of this.listeners) listener(event);
  };

  private controls: InputControls = {
    move: (x, y) => {
      if (!this.enabled) return;
      this.motion.setAxis(x, y);
    },
    moveTo: (x) => {
      if (!this.enabled) return;
      this.motion.setAbsolute(x);
    },
    reach: (x, y) => {
      if (!this.enabled) return;
      this.motion.setReach(x, y);
    },
    guard: () => {
      if (!this.enabled) return false;
      const raised = this.motion.raiseGuard();
      if (raised) for (const listener of this.guardListeners) listener(true);
      return raised;
    },
  };

  addSource(source: InputSource): void {
    if (this.sources.has(source.id)) return;
    this.sources.set(source.id, source);
    source.attach(this.emit, this.controls);
  }

  removeSource(id: string): void {
    const source = this.sources.get(id);
    if (!source) return;
    source.detach();
    this.sources.delete(id);
  }

  onPunch(listener: PunchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onGuard(listener: GuardListener): () => void {
    this.guardListeners.add(listener);
    return () => this.guardListeners.delete(listener);
  }

  /** Advance the movement model. Driven once per frame by `GameManager.tick`. */
  update(dt: number, now: number): void {
    this.motion.update(dt, now);
  }

  /** Which of LEFT/CENTER/RIGHT the player is standing in, or null. */
  get stance(): Stance | null {
    return this.motion.stance;
  }

  /** The nearest lane, never null. What the kart chase resolves rows against. */
  get lane(): Stance {
    return this.motion.lane;
  }

  /** Which word-connect slot the hand is reaching at, or null. */
  get slotIndex(): number | null {
    return this.motion.slotIndex;
  }

  get direction(): MoveDirection | null {
    return this.motion.direction;
  }

  isGuarding(): boolean {
    return this.motion.isGuarding();
  }

  /** Called by the 3D scene as the pointer moves over / off a target. */
  setAimLane(lane: number | null): void {
    this.aimLane = lane;
  }

  getAimLane(): number | null {
    return this.aimLane;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.motion.setAxis(0, 0);
      this.motion.setReach(0, 0);
    }
  }

  /**
   * Injection point for punches that need a raycast to resolve — the 3D scene
   * calls this when the pointer hits an answer target, and with `laneIndex:
   * null` when the click hits nothing. It is the mouse's equivalent of an
   * `InputSource`, living in the scene because only the renderer can turn
   * screen coordinates into a lane.
   */
  punch(event: Partial<PunchEvent>): void {
    this.emit(createPunchEvent(event));
  }

  dispose(): void {
    for (const source of this.sources.values()) source.detach();
    this.sources.clear();
    this.listeners.clear();
    this.guardListeners.clear();
  }
}

/** Movement keys, grouped so both WASD and the arrow cluster work. */
const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, 1],
  KeyW: [0, 1],
  ArrowDown: [0, -1],
  KeyS: [0, -1],
};

/**
 * Walk with the arrows or WASD, tap 1 · 2 · 3 to step straight to a lane,
 * Space to punch whatever you are standing in front of, Shift to guard.
 *
 * The same arrows aim the hand during Word Connect, where the feet stay
 * planted — this class does not know the difference, and does not need to.
 *
 * Movement is continuous rather than a lane picker on purpose: it is the same
 * shape of signal a webcam tracker or a joystick produces, so swapping one in
 * later changes nothing above this class.
 */
export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private emit: PunchListener | null = null;
  private controls: InputControls | null = null;
  private held = new Set<string>();

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.emit || !this.controls) return;

    if (event.code in MOVE_KEYS) {
      event.preventDefault();
      if (event.repeat) return;
      this.held.add(event.code);
      this.pushAxis();
      return;
    }

    if (event.repeat) return;

    const lane = LANE_KEYS.indexOf(event.code as (typeof LANE_KEYS)[number]);
    if (lane >= 0) {
      event.preventDefault();
      this.controls.moveTo([-1, 0, 1][lane]);
      return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      event.preventDefault();
      this.controls.guard();
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      // laneIndex stays null — the game resolves it from where the player is
      // standing, which is the whole point of the two-step answer.
      this.emit(createPunchEvent({ laneIndex: null, source: 'keyboard' }));
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.held.delete(event.code)) return;
    this.pushAxis();
  };

  /** Releasing focus must not leave the player sliding into a wall. */
  private onBlur = (): void => {
    this.held.clear();
    this.controls?.move(0, 0);
  };

  private pushAxis(): void {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      const [dx, dy] = MOVE_KEYS[code];
      x += dx;
      y += dy;
    }
    this.controls?.move(Math.sign(x), Math.sign(y));
  }

  attach(emit: PunchListener, controls: InputControls): void {
    this.emit = emit;
    this.controls = controls;
    // No DOM means no keyboard — the rest of the simulation still runs, which
    // is what lets the gameplay be tested without a browser.
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    }
    this.held.clear();
    this.emit = null;
    this.controls = null;
  }
}
