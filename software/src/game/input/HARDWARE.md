# Adding a physical punch controller

The gameplay core only ever sees `PunchEvent`s arriving from `InputManager`.
To support new hardware, implement `InputSource` and register it — nothing in
`GameManager`, the scene, or the HUD needs to change.

```ts
import {
  createPunchEvent,
  type InputControls,
  type InputSource,
  type PunchListener,
} from './';

export class Esp32Source implements InputSource {
  readonly id = 'esp32';
  private socket: WebSocket | null = null;
  private emit: PunchListener | null = null;

  attach(emit: PunchListener, controls: InputControls) {
    this.emit = emit;
    this.socket = new WebSocket('ws://192.168.4.1:81');
    this.socket.onmessage = (msg) => {
      const imu = JSON.parse(msg.data); // { ax, ay, az, joy, button, peak }

      // Where the player is standing decides which answer a punch counts for.
      // The same signal aims the hand during Word Connect — the game switches
      // what it steers, the device does not have to care.
      controls.move(imu.joy === 'LEFT' ? -1 : imu.joy === 'RIGHT' ? 1 : 0, 0);
      if (imu.button) controls.guard();

      if (!isPunch(imu)) return;
      this.emit?.(
        createPunchEvent({
          laneIndex: null,               // the game fills this in from the stance
          direction: { x: imu.ax, y: imu.ay, z: -Math.abs(imu.az) },
          hand: 'right',
          confidence: clamp01(imu.peak / PUNCH_THRESHOLD),
          power: clamp01(imu.peak / MAX_G),
          source: 'device',
        }),
      );
    };
  }

  detach() {
    this.socket?.close();
    this.socket = null;
    this.emit = null;
  }
}

// then, once:
inputManager.addSource(new Esp32Source());
```

The same shape works for MediaPipe hand tracking (`source: 'motion'`,
confidence from the landmark score) or a phone's DeviceMotion API.

## Movement, guard, and how a punch picks a target

Answering takes two steps: the player walks to an answer, and *then* punches.
The lane a punch counts for comes from where the player is standing — not from
the punch itself. So a device should send `laneIndex: null` and drive the
position separately.

`attach` receives an `InputControls` object alongside `emit` for exactly that.
A source that only throws punches can ignore it:

```ts
attach(emit: PunchListener, controls: InputControls) {
  // Absolute body position, normalised: -1 = LEFT, 0 = CENTER, +1 = RIGHT.
  // A pose tracker maps the player's chest x across the capture width;
  // a joystick can send its axis straight through.
  controls.moveTo(chestX);

  // ...or a steering intent, for anything that only reports a direction.
  controls.move(-1, 0);

  // Where the hand is pointing: -1..1 per axis, (0, 0) at rest by the chest.
  controls.reach(wristX, wristY);

  // Raise the guard. Returns false while it is still on cooldown.
  controls.guard();
}
```

## Two ways to aim, and which one is live

The player aims with the feet while answering and with the hand during Word
Connect, so `PlayerMotion` keeps them as two channels:

| | Answering | Word Connect |
| --- | --- | --- |
| Body | walks LEFT · CENTER · RIGHT → `stance` | planted dead centre |
| Hand | ignored | reaches UP · RIGHT · DOWN · LEFT → `slotIndex` |

`GameManager` flips `motion.setMode()` between `STANCE` and `REACH` as the
mini game opens and closes. That decides where `controls.move` lands, so **a device with a
single axis pair works in both** — a joystick steers the feet while a question
is up and the hand while a word is up, without knowing which is happening.

The other two controls are unambiguous and always mean the same thing:
`moveTo` is the body (and is ignored while the feet are planted), `reach` is
the hand. A tracker that follows a chest *and* a wrist should use those two
rather than `move`, and can stream both continuously.

`PlayerMotion` turns the body position into a `stance` (with a tolerance from
`STANCE_TOLERANCE`) and the hand into a `direction` / `slotIndex` (past
`DIRECTION_DEADZONE` on the dominant axis). The hand is modelled as a spring:
it tracks the direction being pushed and falls back to rest on its own, so
swinging from UP to LEFT is one movement rather than two.

If a device *does* send an explicit `laneIndex` — a mouse click on a specific
block — the game only honours it when it agrees with where the player is
aiming. That is what stops any input from skipping the move.

### Word Connect needs no punch

Answering is two steps because standing in a lane has to be separable from
committing to it. A letter slot has nothing else to mean, so **the reach
commits on its own**: crossing `DIRECTION_DEADZONE` into a slot connects that
letter, and a device driving `controls.reach` needs to send no punch at all.

Only a *change* of slot counts, so a held direction connects one letter rather
than a stream, and a direction still held when the next word appears does not
spend a letter from it. A reach back over a letter already connected is
ignored; a reach at the wrong letter loses the word immediately.

A punch is still honoured when it names a letter by itself — a pointer on a
tile, or a device reporting the `direction` its fist travelled — so a glove can
throw a straight upward jab without streaming a reach signal at all.

### Mapping the two projects in this repo

- **`punching.ino`** already streams everything needed over serial:
  `punchPower` past the threshold is the punch, `joy` (LEFT/RIGHT) drives
  `controls.move` — which walks between answers and aims at letters in turn —
  and `button` is a natural guard. With a second joystick axis, pass it through
  as the `y` of the same `move` call and Word Connect gains up/down for free.
- **`computer vision.py`** tracks A = chest and B = right wrist. Chest x
  normalised across the frame is `controls.moveTo`; the wrist offset from the
  chest, normalised by shoulder width, is `controls.reach`; wrist velocity
  toward the camera is the punch. That maps the real thing exactly: the player
  steps left and right and punches to answer, then simply throws the arm out —
  no punch required — to connect letters.
