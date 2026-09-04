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
      const imu = JSON.parse(msg.data); // { ax, ay, az, tilt, peak }

      // Where the player is standing decides which answer a punch counts for,
      // so the position is driven separately from the punch. `moveTo` is the
      // body and nothing else — it is ignored while the feet are planted for
      // Word Connect, so a device can stream it continuously.
      controls.moveTo(imu.tilt);
      if (isGuardPose(imu)) controls.guard();

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

| | Answering | Word Connect | Kart Chase |
| --- | --- | --- | --- |
| Body | walks LEFT · CENTER · RIGHT → `stance` | planted dead centre | steers between the same three lanes → `lane` |
| Hand | ignored | reaches UP · RIGHT · DOWN · LEFT → `slotIndex` | ignored |

The chase deliberately adds no third channel. It is the body channel again, so
anything that already drives `moveTo` or `move` steers the kart with no extra
mapping — see below for why it reads `lane` rather than `stance`.

`GameManager` flips `motion.setMode()` between `STANCE` and `REACH` as the
mini game opens and closes. That decides where `controls.move` lands, so **a
device with a single axis pair works in both** — one stick steers the feet
while a question is up and the hand while a word is up, without knowing which
is happening. The keyboard is what actually uses this; the devices in this repo
each track a real body part, and so take the two unambiguous channels instead.

Those two always mean the same thing: `moveTo` is the body (and is ignored
while the feet are planted), `reach` is the hand. A tracker that follows a
chest *and* a wrist should use them rather than `move`, and can stream both
continuously.

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

### The kart chase needs no punch either — and no lane tolerance

Answering resolves a punch against `stance`, which is `null` whenever the
player is standing in a gap between two lanes: there, the position *is* the
answer, so an ambiguous one has to be a miss rather than a guess at the nearer
block.

Driving is the opposite case. A kart is always physically somewhere on the
road, and a row of pictures arriving has to resolve against a lane whether or
not the player has settled into one — so the chase reads `motion.lane`, which
rounds to the nearest lane and is never `null`.

Nothing the player does commits anything during a chase: the row arriving is
what resolves it, on its own schedule. A device therefore only has to stream a
position. Punches are ignored, `reach` is ignored, and the guard does nothing.

**Tilt steering.** `controller.ino` publishes a `tilt` field for exactly this,
computed as `atan2(ay, az)` normalised by `tiltRange` — an *absolute* roll
angle out of gravity, not an integrated gyro rate, so letting go of the
controller really does return the kart to the centre lane. It is already the
-1..1 shape `moveTo` wants:

```ts
// The whole of the kart chase control scheme.
controls.moveTo(payload.tilt);
```

The same call still walks between answers while a question is up, so one tilt
signal covers both without the device knowing which is running.

## The devices in this repo, and how they are wired in

Both are live. `BridgeSource` is the one `InputSource` that carries them, and
`bridge.py` is the process they all meet in.

```
  ESP32                                   webcam
  controller.ino                          computer vision.py
      │ POST /api/controller  ▲               │ POST /api/vision
      │ every 50 ms           │ the reply     │ every frame
      ▼                       │               ▼
  ┌──────────────────────────────────────────────────┐
  │                 bridge.py  :5000                 │
  └──────────────────────────────────────────────────┘
      ▲ GET /api/input                ▲ POST /api/feedback
      │ polled at 50 Hz               │ on game events
  ┌──────────────────────────────────────────────────┐
  │  BridgeSource ─→ InputManager ─→ GameManager     │
  │  HardwareFeedback ←──────────────── event bus    │
  └──────────────────────────────────────────────────┘
```

- **`controller.ino`** → `punchCount` past the accelerometer threshold is the
  punch, and `tilt` is `controls.moveTo`, which walks between answers and
  steers the kart with the same signal. `joy` and `buttonCount` never reach the
  simulation: they are the menus, above.
- **`computer vision.py`** tracks A = chest, B = right wrist, and P = the palm.
  Chest x across the frame is `controls.moveTo`; the wrist offset from the
  chest, normalised by shoulder width, is `controls.reach`; a fist driven back
  toward the chest is the punch; the palm parked on the chest is the guard. The
  player steps left and right and punches to answer, then simply throws the arm
  out — no punch required — to connect letters.

### Who owns which channel

Both devices can report a body position, so they cannot both drive one. The
camera wins wherever it can see, and the controller covers what it cannot:

| | Body | Hand | Punch | Guard |
| --- | --- | --- | --- | --- |
| Camera present | `bodyX` | `handX/handY` | either | `guardCount` |
| Camera absent | `tilt` | — | controller | — |

Merging them instead — averaging two body positions, or letting a centred
joystick write the reach axis the camera is already driving — puts the player
in a lane they are not standing in, and cancels an arm they are still holding
up. Priority is the whole rule.

The two empty cells are deliberate. The hand and the guard are gestures, and
without a camera there is nothing to read them from: the joystick could stand
in for the reach axis, but it is not allowed to, for the reason below.

### The stick and the button are interface controls

Everything the player does **in the fight** is done with the body: walk, punch,
block. The controller's joystick and button do not appear in the table above at
all, because they drive the menus and the pause screen and nothing else.

The reason is physical. The board is strapped to the fist that throws the
punches, so mid-round the thumb is closed around it — a control that mattered
during a question would be one the player cannot reach at the moment it counts.
Between rounds the same thumb is free, and a stick beats walking back to the
keyboard to pick "Play".

They therefore leave `BridgeSource` through a different door:

```ts
bridge.onUi((intent) => hardwareMenu.apply(intent)); // { step, press }
```

`onUi` is not part of `InputControls`, so there is no path from a menu control
into the simulation even by mistake. `HardwareMenu` moves the browser's focus
between the `[data-ui]` elements of whichever `.layer--modal` is open and
clicks the focused one — the same two things Tab and Enter already do — with
one extra verb, `press` during `PLAYING`, which pauses. Resuming needs no
second meaning: the pause screen focuses Resume, so the next press clicks it.

A held stick reports the same direction at every poll, so only a *change* of
direction steps the focus. `UP`/`LEFT` step back, `DOWN`/`RIGHT` step on, and a
stick already pushed when the game starts arms rather than moving anything.

The stick moves focus and the button clicks; neither *edits*. The volume and
speed sliders on the settings screen are therefore mouse and keyboard only —
the stick steps over them. Dragging a value is not selection, and the only way
to do it from here would be to write into a React-controlled input behind
React's back, which is a worse thing to own than a screen that wants a mouse.

### Blocking is a gesture the camera reads

`computer vision.py` tracks a palm — the midpoint of the index and pinky
knuckles and the wrist — and raises the guard while it sits inside a circle
centred on the chest, `GUARD_DISTANCE` shoulder widths across.

The circle is drawn on the tracking window, so the gesture can be checked
without the game running. Two details keep it from firing on its own:

- **A dwell.** A punch thrown at the camera also finishes with the fist
  crossing the chest — the arm foreshortens and the wrist converges on A — so
  the two gestures are separated by how long the hand stays. `GUARD_DWELL_S`
  is that difference: a punch passes through the circle, a guard parks in it.
- **A wider release than entry.** A palm resting on the boundary would
  otherwise chatter the guard on and off at the frame rate.

The game reads `guardCount`, not the `guard` flag, for the reason every other
counter exists here: the guard is *held* by the player, and a 50 Hz poll of a
held pose would otherwise raise fifty blocks a second. One rise is one block,
and `raiseGuard` still drops it after `GUARD_ACTIVE_SECONDS` — so standing with
your hands up does not block, and the timing is still yours to get right.

### Counters, not flags

`punchCount`, `guardCount` and `buttonCount` only ever go up, and the game
fires one event per increment. This matters because the clocks do not line up:
the firmware holds `action: "PUNCH"` for 800 ms so the OLED can show it, which
a 50 Hz poll would otherwise read as forty punches. A guard is worse — the
player holds that pose deliberately, for as long as they like.

Three consequences fall out of the same rule, and `BridgeSource.test.ts` pins
all of them:

- A device already powered up when the game starts arrives mid-count. The first
  reading only records the baseline, so its history is not replayed as a burst
  of punches at the first question.
- A device that drops off the network and returns re-arms the same way. A punch
  thrown during a two-second dropout is stale by the time the packet lands, and
  firing it then would score it against a different question.
- A counter that jumps by more than one still fires once, for the same reason.

### Feedback, on the reply to the push

The controller already POSTs every 50 ms and used to throw the reply away, so
the reply is where the game answers: a one-shot `cmd` (LED colour, buzzer tone,
a line for the OLED) plus a running `status` (score, HP, combo). No second
connection, no polling loop on the device, and no latency that the state push
was not already paying.

`HardwareFeedback` listens to the game's existing event bus and posts a
semantic kind — `correct`, `hurt`, `special` — never a colour. The mapping from
kind to hardware lives in `FEEDBACK` in `bridge.py`, so retuning the LEDs and
the buzzer is a text edit and a restart of one Python process: no rebuild, no
reflash.

Several events can land inside one push window, so only one command is ever
pending and the more significant one wins the slot (`PRIORITY` in `bridge.py`).
A backlog would arrive behind the punches that caused it, which reads worse
than a dropped flash.

### Running it

```bash
python bridge.py            # the hub, port 5000
python "computer vision.py" # tracking; --no-bridge to track without the game
cd software && npm run dev  # the game, proxying /bridge to port 5000
```

or `run_linguaplay.bat` to start all three. The game is playable on the
keyboard throughout: with no bridge running `BridgeSource` retries quietly in
the background, so there is no hardware mode to be in the wrong one of. The
menu shows which devices are actually connected, and
`http://127.0.0.1:5000/api/health` shows what the bridge is hearing.

Point the browser at another machine's bridge with `BRIDGE_URL`, and the ESP32
at this one by setting `API_URL` in `controller.ino` to its IPv4 address.
