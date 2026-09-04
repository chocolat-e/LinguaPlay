import { describe, expect, it } from 'vitest';
import { BridgeReader, type BridgeSnapshot } from './BridgeSource';

/** A snapshot with both devices offline unless the test says otherwise. */
function snapshot(partial: BridgeSnapshot = {}): BridgeSnapshot {
  return {
    now: 0,
    controller: { online: false },
    vision: { online: false },
    ...partial,
  };
}

const controllerAt = (punchCount: number, extra = {}): BridgeSnapshot =>
  snapshot({ controller: { online: true, punchCount, ...extra } });

describe('BridgeReader punches', () => {
  it('does not fire on the first sighting of a counter', () => {
    const reader = new BridgeReader();

    // The controller has been powered up since before the game started, so it
    // arrives mid-count. Replaying that history would throw a burst of punches
    // at the first question.
    expect(reader.read(controllerAt(417), 0).punches).toHaveLength(0);
  });

  it('fires exactly one punch per increment', () => {
    const reader = new BridgeReader();
    reader.read(controllerAt(10), 0);

    expect(reader.read(controllerAt(11), 1000).punches).toHaveLength(1);
    expect(reader.read(controllerAt(12), 2000).punches).toHaveLength(1);
  });

  it('ignores a counter that has not moved, however often it is read', () => {
    const reader = new BridgeReader();
    reader.read(controllerAt(10), 0);
    reader.read(controllerAt(11), 1000);

    // The firmware holds `action: PUNCH` for 800 ms; polling at 50 Hz reads the
    // same count dozens of times, and none of them is a new punch.
    for (let i = 0; i < 40; i += 1) {
      expect(reader.read(controllerAt(11), 1000 + i * 20).punches).toHaveLength(0);
    }
  });

  it('collapses a missed backlog into one punch', () => {
    const reader = new BridgeReader();
    reader.read(controllerAt(10), 0);

    // Three punches happened while the bridge was unreachable. They are stale
    // by now, and firing them late would land them on the wrong question.
    expect(reader.read(controllerAt(13), 5000).punches).toHaveLength(1);
  });

  it('treats a device reboot as no punch, but stays armed afterwards', () => {
    const reader = new BridgeReader();
    reader.read(controllerAt(200), 0);

    // The counter restarting at 1 is a power cycle, not two hundred undos.
    expect(reader.read(controllerAt(1), 1000).punches).toHaveLength(0);
    expect(reader.read(controllerAt(2), 2000).punches).toHaveLength(1);
  });

  it('counts one punch when both devices see the same fist', () => {
    const reader = new BridgeReader();
    const both = (controllerCount: number, visionCount: number): BridgeSnapshot => ({
      now: 0,
      controller: { online: true, punchCount: controllerCount },
      vision: { online: true, punchCount: visionCount },
    });

    reader.read(both(0, 0), 0);

    // The controller is worn on the hand the camera is watching, so one throw
    // arrives twice within a few milliseconds.
    expect(reader.read(both(1, 1), 1000).punches).toHaveLength(1);

    // Far enough apart to be two real punches.
    expect(reader.read(both(2, 2), 3000).punches).toHaveLength(1);
  });

  it('reads a rising edge from firmware with no counter', () => {
    const reader = new BridgeReader();
    const action = (value: string): BridgeSnapshot =>
      snapshot({ controller: { online: true, action: value } });

    reader.read(action('READY'), 0);
    expect(reader.read(action('PUNCH'), 1000).punches).toHaveLength(1);
    // Still PUNCH for the rest of showDuration — the same punch, not more.
    expect(reader.read(action('PUNCH'), 1400).punches).toHaveLength(0);
    reader.read(action('READY'), 2000);
    expect(reader.read(action('PUNCH'), 3000).punches).toHaveLength(1);
  });

  it('does not fire a punch thrown while the device was unreachable', () => {
    const reader = new BridgeReader();
    reader.read(controllerAt(10), 0);

    // WiFi drops for two seconds. The player throws a punch during it, so the
    // counter has moved on by the time the controller comes back — but landing
    // it now would land it on whatever question is up two seconds later.
    reader.read(snapshot({ controller: { online: false } }), 1000);
    expect(reader.read(controllerAt(11), 3000).punches).toHaveLength(0);

    // Re-armed, so the next real punch counts.
    expect(reader.read(controllerAt(12), 4000).punches).toHaveLength(1);
  });

  it('re-arms the button across a dropout too', () => {
    const reader = new BridgeReader();
    reader.read(snapshot({ controller: { online: true, buttonCount: 2 } }), 0);
    reader.read(snapshot({ controller: { online: false } }), 100);

    expect(reader.read(snapshot({ controller: { online: true, buttonCount: 3 } }), 200).ui.press)
      .toBe(false);
    expect(reader.read(snapshot({ controller: { online: true, buttonCount: 4 } }), 300).ui.press)
      .toBe(true);
  });

  it('ignores devices that are offline', () => {
    const reader = new BridgeReader();
    const offline = snapshot({ controller: { online: false, punchCount: 1 } });

    reader.read(offline, 0);
    expect(reader.read(snapshot({ controller: { online: false, punchCount: 2 } }), 1000).punches)
      .toHaveLength(0);
  });
});

describe('BridgeReader guard', () => {
  const guardingAt = (guardCount: number): BridgeSnapshot =>
    snapshot({ vision: { online: true, guardCount, guard: true } });

  it('raises the guard once per gesture, not once per poll', () => {
    const reader = new BridgeReader();

    reader.read(guardingAt(3), 0);
    expect(reader.read(guardingAt(4), 100).guard).toBe(true);
    // The palm stays on the chest, so the camera keeps reporting the same
    // count. Holding a block is not blocking twice.
    expect(reader.read(guardingAt(4), 120).guard).toBe(false);
    expect(reader.read(guardingAt(5), 900).guard).toBe(true);
  });

  it('falls back to the held flag from a CV script with no counter', () => {
    const reader = new BridgeReader();
    const held = (guard: boolean): BridgeSnapshot =>
      snapshot({ vision: { online: true, guard } });

    reader.read(held(false), 0);
    expect(reader.read(held(true), 100).guard).toBe(true);
    expect(reader.read(held(true), 200).guard).toBe(false);
    reader.read(held(false), 300);
    expect(reader.read(held(true), 400).guard).toBe(true);
  });

  it('re-arms the guard across a camera dropout', () => {
    const reader = new BridgeReader();
    reader.read(guardingAt(2), 0);
    reader.read(snapshot({ vision: { online: false } }), 100);

    // A guard raised while the camera was gone is stale by the time it
    // arrives, and the blow it was meant to stop has already landed.
    expect(reader.read(guardingAt(3), 200).guard).toBe(false);
    expect(reader.read(guardingAt(4), 300).guard).toBe(true);
  });

  it('never lets the controller raise the guard', () => {
    const reader = new BridgeReader();
    const pressing = (buttonCount: number): BridgeSnapshot =>
      snapshot({ controller: { online: true, buttonCount, button: 1 } });

    reader.read(pressing(1), 0);
    const pressed = reader.read(pressing(2), 100);

    // Blocking is a gesture the camera sees. The button is a menu control, and
    // a player whose fist is busy punching cannot work it mid-wind-up anyway.
    expect(pressed.guard).toBe(false);
    expect(pressed.ui.press).toBe(true);
  });
});

describe('BridgeReader interface controls', () => {
  const stick = (joy: string): BridgeSnapshot => snapshot({ controller: { online: true, joy } });

  it('steps the focus once per flick, not once per poll', () => {
    const reader = new BridgeReader();

    reader.read(stick('CENTER'), 0);
    expect(reader.read(stick('DOWN'), 100).ui.step).toBe(1);
    // Held. The player is looking at a highlight that has already moved.
    for (let i = 0; i < 20; i += 1) {
      expect(reader.read(stick('DOWN'), 120 + i * 20).ui.step).toBe(0);
    }
    reader.read(stick('CENTER'), 600);
    expect(reader.read(stick('DOWN'), 700).ui.step).toBe(1);
  });

  it('arms on the first sighting rather than stepping', () => {
    const reader = new BridgeReader();

    // The controller was already sitting with the stick pushed when the game
    // started, which is a resting hand, not a request.
    expect(reader.read(stick('RIGHT'), 0).ui.step).toBe(0);
    expect(reader.read(stick('RIGHT'), 100).ui.step).toBe(0);
  });

  it('reads up and left as back, down and right as forward', () => {
    const reader = new BridgeReader();
    reader.read(stick('CENTER'), 0);

    // One stick, two menu axes: which way a list runs is not something the
    // player should have to remember while holding it.
    expect(reader.read(stick('UP'), 100).ui.step).toBe(-1);
    expect(reader.read(stick('LEFT'), 200).ui.step).toBe(-1);
    expect(reader.read(stick('DOWN'), 300).ui.step).toBe(1);
    expect(reader.read(stick('RIGHT'), 400).ui.step).toBe(1);
    expect(reader.read(stick('CENTER'), 500).ui.step).toBe(0);
  });

  it('presses once per press of the button', () => {
    const reader = new BridgeReader();
    const held = (buttonCount: number): BridgeSnapshot =>
      snapshot({ controller: { online: true, buttonCount } });

    reader.read(held(3), 0);
    expect(reader.read(held(4), 100).ui.press).toBe(true);
    expect(reader.read(held(4), 120).ui.press).toBe(false);
    expect(reader.read(held(5), 900).ui.press).toBe(true);
  });

  it('re-arms a stick still held when the controller comes back', () => {
    const reader = new BridgeReader();
    reader.read(stick('CENTER'), 0);
    reader.read(stick('LEFT'), 100);
    reader.read(snapshot({ controller: { online: false } }), 200);

    // Still held in the same direction after the dropout: a hand that never
    // moved must not read as a fresh flick of the stick.
    expect(reader.read(stick('LEFT'), 300).ui.step).toBe(0);
    reader.read(stick('CENTER'), 400);
    expect(reader.read(stick('LEFT'), 500).ui.step).toBe(-1);
  });

  it('asks for nothing from a controller that is not there', () => {
    const reader = new BridgeReader();
    const offline = snapshot({ controller: { online: false, joy: 'LEFT', buttonCount: 9 } });

    expect(reader.read(offline, 0).ui).toEqual({ step: 0, press: false });
  });
});

describe('BridgeReader channel ownership', () => {
  it('lets the camera own the body, and the controller steer without one', () => {
    const reader = new BridgeReader();

    const seen = reader.read(
      snapshot({
        controller: { online: true, tilt: -0.9 },
        vision: { online: true, bodyX: 0.4 },
      }),
      0,
    );
    // Both could drive the body; the one that can actually see where the
    // player is standing wins, rather than the two averaging into a lane the
    // player is not in.
    expect(seen.moveTo).toBe(0.4);

    const blind = reader.read(snapshot({ controller: { online: true, tilt: -0.9 } }), 100);
    expect(blind.moveTo).toBeCloseTo(-0.9);
  });

  it('gives the hand to the camera alone', () => {
    const reader = new BridgeReader();
    reader.read(snapshot({ controller: { online: true, joy: 'CENTER' } }), 0);

    const seen = reader.read(
      snapshot({
        controller: { online: true, joy: 'LEFT' },
        vision: { online: true, handX: 0.2, handY: 0.8 },
      }),
      100,
    );
    expect(seen.reach).toEqual([0.2, 0.8]);

    // With no camera the hand simply has no source. The stick is a menu
    // control now, and letting it fall back onto the reach axis would put a
    // centred stick on top of an arm the player is actually holding up.
    const blind = reader.read(snapshot({ controller: { online: true, joy: 'RIGHT' } }), 200);
    expect(blind.reach).toBeNull();
    expect(blind.guard).toBe(false);
    // It moved the menu instead, which is all it is allowed to move.
    expect(blind.ui.step).toBe(1);
  });

  it('asks for nothing at all when no device is connected', () => {
    const reader = new BridgeReader();
    const actions = reader.read(snapshot(), 0);

    // The keyboard is still attached, so touching any channel here would fight
    // whatever the player is doing with it.
    expect(actions.moveTo).toBeNull();
    expect(actions.reach).toBeNull();
    expect(actions.guard).toBe(false);
    expect(actions.punches).toHaveLength(0);
    expect(actions.ui).toEqual({ step: 0, press: false });
  });
});
