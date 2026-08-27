# Adding a physical punch controller

The gameplay core only ever sees `PunchEvent`s arriving from `InputManager`.
To support new hardware, implement `InputSource` and register it — nothing in
`GameManager`, the scene, or the HUD needs to change.

```ts
import { createPunchEvent, type InputSource, type PunchListener } from './';

export class Esp32Source implements InputSource {
  readonly id = 'esp32';
  private socket: WebSocket | null = null;
  private emit: PunchListener | null = null;

  attach(emit: PunchListener) {
    this.emit = emit;
    this.socket = new WebSocket('ws://192.168.4.1:81');
    this.socket.onmessage = (msg) => {
      const imu = JSON.parse(msg.data); // { ax, ay, az, gx, gy, gz }
      if (!isPunch(imu)) return;
      this.emit?.(
        createPunchEvent({
          laneIndex: null,               // resolved from direction below
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

## Direction → lane

Events sent with `laneIndex: null` are resolved by the game: it uses the
pointer's current aim if there is one, otherwise the live target nearest the
strike plane. A motion controller that knows *where* the player punched should
map its direction vector onto the 2×2 grid itself:

```
laneIndex = (direction.y >= 0 ? 0 : 2) + (direction.x >= 0 ? 1 : 0)
```
