import { createPunchEvent, type PunchEvent } from './PunchEvent';
import type { InputControls, InputSource, PunchListener } from './InputManager';

/**
 * The ESP32 and the webcam, arriving as one `InputSource`.
 *
 * Both devices push their state to `bridge.py`; this polls the merged snapshot
 * and turns it into the same `controls` calls and `PunchEvent`s the keyboard
 * produces. `GameManager` cannot tell the difference, which is the whole point
 * of the input layer — see HARDWARE.md.
 *
 * The split between them is by gesture, not by device. Everything the player
 * does *in the fight* — stand, punch, block — is read off the camera and the
 * accelerometer, because a fist wrapped around a controller cannot work a
 * stick. The stick and the button drive the menus, and leave here through
 * `onUi` rather than through `controls`, so no menu control can reach the
 * simulation even by accident.
 *
 * Reading rather than being pushed to is deliberate. The devices run on their
 * own clocks (the controller pushes every 100 ms, the camera at whatever frame
 * rate it manages) and the game runs on the display's. Polling a *latest state*
 * lets the three disagree without any of them blocking, and means a dropped
 * packet costs one stale frame rather than a desynchronised input queue.
 */

/** What the ESP32 firmware sends. Every field optional — see BridgeReader. */
export interface ControllerPacket {
  action?: string;
  /** Stick direction. Drives the menus only; see BridgeUiIntent. */
  joy?: string;
  button?: number;
  tilt?: number;
  punchPower?: number;
  accPower?: number;
  /** Monotonic counters. Absent on firmware older than the bridge. */
  punchCount?: number;
  buttonCount?: number;
  online?: boolean;
  ageMs?: number | null;
}

/** What `computer vision.py` sends. */
export interface VisionPacket {
  /** Chest x across the frame, -1 LEFT to +1 RIGHT. */
  bodyX?: number;
  zone?: string;
  /** Wrist offset from the chest, normalised by shoulder width, -1..1. */
  handX?: number;
  handY?: number;
  direction?: string | null;
  punchCount?: number;
  /** True while the palm is parked inside the guard circle on the chest. */
  guard?: boolean;
  /** Monotonic count of guards raised. The event the game acts on. */
  guardCount?: number;
  poseOk?: boolean;
  fps?: number;
  online?: boolean;
  ageMs?: number | null;
}

export interface BridgeSnapshot {
  now?: number;
  controller?: ControllerPacket;
  vision?: VisionPacket;
}

/**
 * What the controller is asking the *interface* to do, as opposed to the game.
 *
 * The stick and the button drive menus and the pause screen and nothing else:
 * both sit under the thumb of a fist that is busy punching, so a control that
 * mattered mid-fight would be one the player cannot reach when it counts. The
 * body, the punch, and the guard are all gestures now.
 */
export interface BridgeUiIntent {
  /** Move the focus through the on-screen controls: -1 back, +1 on, 0 stay. */
  step: number;
  /** The button went down: confirm in a menu, pause while playing. */
  press: boolean;
}

/** What one snapshot asks the game to do. Returned rather than applied so the
 *  mapping can be tested without a network or a running simulation. */
export interface BridgeActions {
  /** Absolute body position, or null to leave the body alone this tick. */
  moveTo: number | null;
  /** Hand position, or null to leave the reach alone. */
  reach: [number, number] | null;
  guard: boolean;
  punches: PunchEvent[];
  /** Menu navigation, which no part of the simulation ever sees. */
  ui: BridgeUiIntent;
}

export interface BridgeStatus {
  controller: boolean;
  vision: boolean;
  /** Set while the bridge itself cannot be reached. */
  error: string | null;
}

/** Joystick direction string → which way the focus moves. */
const JOY_STEP: Record<string, number> = {
  LEFT: -1,
  UP: -1,
  RIGHT: 1,
  DOWN: 1,
  CENTER: 0,
};

/**
 * One physical punch can be seen twice: the controller is worn on the same fist
 * the camera is watching. Within this window a second sighting is the same
 * punch, not a new one.
 */
const COALESCE_MS = 220;

/** `punchPower` that counts as a full-strength hit, for FX intensity. */
const FULL_POWER_G = 3;

/** Matches `punchThreshold` in controller.ino, for the confidence ratio. */
const PUNCH_THRESHOLD_G = 1.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Turns bridge snapshots into game actions, and owns the edge detection.
 *
 * Punches arrive as a monotonic *count* rather than a flag, because the two
 * clocks do not line up: the firmware holds `action: "PUNCH"` for 800 ms so the
 * OLED can show it, which a 50 Hz poll would otherwise read as forty punches.
 * A counter makes the reading rate irrelevant — one increment is one punch,
 * whether it is seen once or ten times. Guards and button presses are read the
 * same way, and for the same reason: a guard is *held* by the player for as
 * long as their palm rests on their chest.
 */
export class BridgeReader {
  private lastControllerPunch: number | null = null;
  private lastVisionPunch: number | null = null;
  private lastVisionGuard: number | null = null;
  private lastButton: number | null = null;
  /** Rising-edge fallbacks for a device that predates the counters. */
  private lastAction: string | null = null;
  private lastButtonLevel = 0;
  private lastGuardLevel = false;
  /** Stick direction last seen, so a held direction steps the menu once. */
  private lastJoy: string | null = null;
  private lastPunchAt = Number.NEGATIVE_INFINITY;

  read(snapshot: BridgeSnapshot, now: number): BridgeActions {
    const controller = snapshot.controller ?? {};
    const vision = snapshot.vision ?? {};
    const controllerOnline = controller.online === true;
    const visionOnline = vision.online === true;

    // A device that has dropped out forgets its baseline, so the first packet
    // after it returns only re-arms. Otherwise a two-second WiFi dropout ends
    // with the punch thrown during it arriving afterwards, landing on whatever
    // question happens to be up by then — the same staleness the first-sighting
    // rule exists to prevent, just arrived at from the other direction.
    if (!controllerOnline) this.forgetController();
    if (!visionOnline) this.forgetVision();

    const actions: BridgeActions = {
      moveTo: null,
      reach: null,
      guard: false,
      punches: [],
      ui: { step: 0, press: false },
    };

    // Ownership is by priority, not by merging: whichever device can see the
    // player's body drives it, and the other stays out of that channel. Two
    // sources writing one axis would otherwise fight every frame — a tilted
    // wrist pulling one way while the camera insists on where the feet are.
    if (visionOnline && finite(vision.bodyX)) {
      actions.moveTo = vision.bodyX;
    } else if (controllerOnline && finite(controller.tilt)) {
      // Absolute roll out of gravity, already in the -1..1 shape moveTo wants.
      actions.moveTo = controller.tilt;
    }

    // The hand is the camera's alone. Nothing on the controller covers it any
    // more: the stick belongs to the menus, and a stick that fell back onto the
    // reach axis would sit centred on top of an arm the player is holding up.
    if (visionOnline && finite(vision.handX) && finite(vision.handY)) {
      actions.reach = [vision.handX, vision.handY];
    }

    // Blocking is a gesture — the palm brought back inside the circle on the
    // chest — so it is the camera's to report, and there is no guard at all
    // without one. `computer vision.py` owns the geometry and the dwell that
    // keeps a punch's own return from reading as a block.
    if (visionOnline) {
      actions.guard = this.readGuard(vision);
    }

    if (controllerOnline) {
      actions.ui = this.readUi(controller);
    }

    // Punches from either device, then coalesced: the reason both are read is
    // that either may be the one the player is actually using.
    if (controllerOnline && this.readControllerPunch(controller)) {
      this.addPunch(actions, now, {
        direction: { x: 0, y: 0, z: -1 },
        confidence: finite(controller.punchPower)
          ? clamp01(controller.punchPower / PUNCH_THRESHOLD_G)
          : 1,
        power: finite(controller.punchPower)
          ? clamp01(controller.punchPower / FULL_POWER_G)
          : 1,
        source: 'device',
      });
    }

    if (visionOnline && this.readVisionPunch(vision)) {
      // The arm's own offset names the letter during Word Connect, so a jab
      // thrown up at a tile connects it without a separate reach signal.
      this.addPunch(actions, now, {
        direction: {
          x: finite(vision.handX) ? vision.handX : 0,
          y: finite(vision.handY) ? vision.handY : 0,
          z: -1,
        },
        confidence: 0.9,
        power: 0.85,
        source: 'motion',
      });
    }

    return actions;
  }

  private addPunch(actions: BridgeActions, now: number, partial: Partial<PunchEvent>): void {
    if (now - this.lastPunchAt < COALESCE_MS) return;
    this.lastPunchAt = now;
    // laneIndex stays null: the lane comes from where the player is standing,
    // which is what stops a device from skipping the walk.
    actions.punches.push(createPunchEvent({ laneIndex: null, hand: 'right', ...partial }));
  }

  private readControllerPunch(controller: ControllerPacket): boolean {
    if (finite(controller.punchCount)) {
      return this.bumped('lastControllerPunch', controller.punchCount);
    }
    // Older firmware only reports a held state. The rise into PUNCH is the
    // event; the 800 ms it stays there is display, not input.
    const action = controller.action ?? null;
    const punched = action === 'PUNCH' && this.lastAction !== 'PUNCH';
    this.lastAction = action;
    return punched;
  }

  private readVisionPunch(vision: VisionPacket): boolean {
    if (!finite(vision.punchCount)) return false;
    return this.bumped('lastVisionPunch', vision.punchCount);
  }

  /**
   * The moment the palm settles inside the guard circle, from the camera.
   *
   * The rise is the event, not the hold: `raiseGuard` puts the guard up for
   * `GUARD_ACTIVE_SECONDS` and then drops it, so a player who simply stands
   * with their hands up still has to time the block against the wind-up. The
   * counter is what makes that survive the poll rate, exactly as for punches.
   */
  private readGuard(vision: VisionPacket): boolean {
    if (finite(vision.guardCount)) {
      return this.bumped('lastVisionGuard', vision.guardCount);
    }
    // A CV script older than the counter reports only the held flag.
    const held = vision.guard === true;
    const raised = held && !this.lastGuardLevel;
    this.lastGuardLevel = held;
    return raised;
  }

  /**
   * The stick and the button, as menu navigation.
   *
   * A stick pushed and held reports the same direction at every poll, so only
   * a *change* of direction steps the focus — the player flicks once per item
   * rather than watching the highlight run to the bottom of the list. The
   * first sighting only records where the stick already is, for the same
   * reason a counter's first sighting fires nothing.
   */
  private readUi(controller: ControllerPacket): BridgeUiIntent {
    const joy = typeof controller.joy === 'string' ? controller.joy : 'CENTER';
    const previous = this.lastJoy;
    this.lastJoy = joy;

    const step = previous === null || joy === previous ? 0 : (JOY_STEP[joy] ?? 0);

    return { step, press: this.readPress(controller) };
  }

  /** The button going down, counted the way the punch is. */
  private readPress(controller: ControllerPacket): boolean {
    if (finite(controller.buttonCount)) {
      return this.bumped('lastButton', controller.buttonCount);
    }
    const level = controller.button === 1 ? 1 : 0;
    const pressed = level === 1 && this.lastButtonLevel === 0;
    this.lastButtonLevel = level;
    return pressed;
  }

  /**
   * True when a counter has moved on since last read.
   *
   * The first sighting only records the value. A device that has been powered
   * up since before the game started arrives mid-count, and replaying that
   * history as live input would throw a burst of punches at the first question.
   * A jump of more than one is still one punch for the same reason: the missed
   * ones are already stale, and a backlog lands behind the action it belongs to.
   */
  private bumped(
    field: 'lastControllerPunch' | 'lastVisionPunch' | 'lastVisionGuard' | 'lastButton',
    count: number,
  ): boolean {
    const previous = this[field];
    this[field] = count;
    if (previous === null) return false;
    // A device that reboots restarts its counter, which must not read as an
    // event, but must re-arm rather than wedging the channel shut.
    return count > previous;
  }

  /** Drop every edge the controller is tracked by: punch, button, and stick. */
  private forgetController(): void {
    this.lastControllerPunch = null;
    this.lastButton = null;
    this.lastAction = null;
    this.lastButtonLevel = 0;
    // Not 'CENTER': a stick that comes back still held in a direction has to
    // re-arm rather than count as a fresh flick of it.
    this.lastJoy = null;
  }

  /** The same for the camera, which now carries the guard as well as punches. */
  private forgetVision(): void {
    this.lastVisionPunch = null;
    this.lastVisionGuard = null;
    this.lastGuardLevel = false;
  }

  reset(): void {
    this.forgetController();
    this.forgetVision();
    this.lastPunchAt = Number.NEGATIVE_INFINITY;
  }
}

export interface BridgeSourceOptions {
  /** Where the bridge lives. Defaults to the dev-server proxy. */
  url?: string;
  /** How often to read the merged snapshot, in ms. */
  intervalMs?: number;
  /** How long to wait before retrying after the bridge refuses a connection. */
  retryMs?: number;
}

/**
 * Polls the bridge and drives the game with whatever the devices are doing.
 *
 * Registered unconditionally: with no bridge running it retries quietly in the
 * background and the keyboard keeps working, so the game has no "hardware mode"
 * to be in the wrong one of.
 */
export class BridgeSource implements InputSource {
  readonly id = 'bridge';

  private readonly url: string;
  private readonly intervalMs: number;
  private readonly retryMs: number;
  private readonly reader = new BridgeReader();

  private emit: PunchListener | null = null;
  private controls: InputControls | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private abort: AbortController | null = null;

  private currentStatus: BridgeStatus = { controller: false, vision: false, error: null };
  private statusListeners = new Set<(status: BridgeStatus) => void>();
  private uiListeners = new Set<(intent: BridgeUiIntent) => void>();

  constructor(options: BridgeSourceOptions = {}) {
    this.url = options.url ?? '/bridge/api/input';
    this.intervalMs = options.intervalMs ?? 20;
    this.retryMs = options.retryMs ?? 1500;
  }

  get status(): BridgeStatus {
    return this.currentStatus;
  }

  onStatus(listener: (status: BridgeStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * The stick and the button, for whoever drives the interface.
   *
   * Deliberately not part of `InputControls`: nothing here is gameplay, and
   * routing it through the same object the punches take would give a menu
   * control a way into the simulation. Only fired on an actual intent, so a
   * stick sitting centred costs nothing.
   */
  onUi(listener: (intent: BridgeUiIntent) => void): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  attach(emit: PunchListener, controls: InputControls): void {
    this.emit = emit;
    this.controls = controls;
    // No fetch means no bridge — the simulation still runs, which is what lets
    // gameplay be tested without a browser.
    if (typeof fetch !== 'function') return;
    this.running = true;
    this.poll();
  }

  detach(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
    this.emit = null;
    this.controls = null;
    this.reader.reset();
    this.setStatus({ controller: false, vision: false, error: null });
  }

  /**
   * One read, then schedule the next.
   *
   * Chained rather than on an interval on purpose: a bridge that has gone away
   * makes every request hang until it times out, and an interval would pile
   * those up until the tab is drowning in sockets it will never get answers to.
   */
  private poll = async (): Promise<void> => {
    if (!this.running) return;

    let delay = this.intervalMs;
    try {
      this.abort = new AbortController();
      const response = await fetch(this.url, {
        signal: this.abort.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`bridge ${response.status}`);
      const snapshot = (await response.json()) as BridgeSnapshot;
      this.apply(snapshot);
    } catch (error) {
      if (!this.running) return;
      delay = this.retryMs;
      this.setStatus({
        controller: false,
        vision: false,
        error: error instanceof Error ? error.message : 'bridge unreachable',
      });
    }

    if (!this.running) return;
    this.timer = setTimeout(this.poll, delay);
  };

  private apply(snapshot: BridgeSnapshot): void {
    const controls = this.controls;
    const emit = this.emit;
    if (!controls || !emit) return;

    const actions = this.reader.read(snapshot, performance.now());

    if (actions.reach) controls.reach(actions.reach[0], actions.reach[1]);
    if (actions.moveTo !== null) controls.moveTo(actions.moveTo);
    if (actions.guard) controls.guard();
    for (const punch of actions.punches) emit(punch);

    // Last, and outside `controls` entirely: the menus are not the simulation.
    // Notified even while `InputManager` is disabled, which is what lets the
    // button that paused the game be the button that resumes it.
    if (actions.ui.step !== 0 || actions.ui.press) {
      for (const listener of this.uiListeners) listener(actions.ui);
    }

    this.setStatus({
      controller: snapshot.controller?.online === true,
      vision: snapshot.vision?.online === true,
      error: null,
    });
  }

  private setStatus(status: BridgeStatus): void {
    const previous = this.currentStatus;
    if (
      previous.controller === status.controller &&
      previous.vision === status.vision &&
      previous.error === status.error
    ) {
      return;
    }
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
