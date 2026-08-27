import { LANE_KEYS } from '../constants';

/** Character equivalents of LANE_KEYS, for the `key` fallback above. */
const LANE_LETTERS = ['a', 's', 'd', 'f'];
import { createPunchEvent, type PunchEvent } from './PunchEvent';

export type PunchListener = (event: PunchEvent) => void;

/**
 * A device that can produce punches. Implement this to add hardware.
 * `emit` is handed in by the InputManager at attach time.
 */
export interface InputSource {
  readonly id: string;
  attach(emit: PunchListener): void;
  detach(): void;
}

/**
 * Fans any number of `InputSource`s into a single stream of `PunchEvent`s.
 *
 * The gameplay core subscribes once, here, and never learns whether the punch
 * came from a mouse, the keyboard, or a glove full of accelerometers.
 */
export class InputManager {
  private sources = new Map<string, InputSource>();
  private listeners = new Set<PunchListener>();
  private enabled = true;
  /** Lane the pointer is currently hovering, used to resolve aim-less punches. */
  private aimLane: number | null = null;

  private emit = (event: PunchEvent): void => {
    if (!this.enabled) return;
    const resolved =
      event.laneIndex === null && this.aimLane !== null
        ? { ...event, laneIndex: this.aimLane }
        : event;
    for (const listener of this.listeners) listener(resolved);
  };

  addSource(source: InputSource): void {
    if (this.sources.has(source.id)) return;
    this.sources.set(source.id, source);
    source.attach(this.emit);
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

  /** Called by the 3D scene as the pointer moves over / off a target. */
  setAimLane(lane: number | null): void {
    this.aimLane = lane;
  }

  getAimLane(): number | null {
    return this.aimLane;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Injection point for punches that need a raycast to resolve — the 3D scene
   * calls this when the pointer hits an answer target, and with `laneIndex:
   * null` when the click hits nothing (a whiff). It is the mouse's equivalent
   * of an `InputSource`, living in the scene because only the renderer can
   * turn screen coordinates into a lane.
   */
  punch(event: Partial<PunchEvent>): void {
    this.emit(createPunchEvent(event));
  }

  dispose(): void {
    for (const source of this.sources.values()) source.detach();
    this.sources.clear();
    this.listeners.clear();
  }
}

/**
 * A/S/D/F select a lane directly; Space throws a punch at whatever the player
 * is currently aiming at (hovered lane, else the closest live target).
 */
export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private emit: PunchListener | null = null;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || !this.emit) return;
    // Prefer the physical key (`code`); fall back to the produced character so
    // non-QWERTY layouts and synthetic events still reach the right lane.
    let lane = LANE_KEYS.indexOf(e.code as (typeof LANE_KEYS)[number]);
    if (lane < 0) lane = LANE_LETTERS.indexOf(e.key.toLowerCase());
    if (lane >= 0) {
      e.preventDefault();
      this.emit(
        createPunchEvent({
          laneIndex: lane,
          source: 'keyboard',
          hand: lane % 2 === 0 ? 'left' : 'right',
          direction: { x: lane % 2 === 0 ? -0.3 : 0.3, y: 0, z: -1 },
        }),
      );
      return;
    }
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      // laneIndex null → InputManager fills in the current aim.
      this.emit(createPunchEvent({ laneIndex: null, source: 'keyboard' }));
    }
  };

  attach(emit: PunchListener): void {
    this.emit = emit;
    window.addEventListener('keydown', this.onKeyDown);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.emit = null;
  }
}
