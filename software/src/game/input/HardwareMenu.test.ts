import { describe, expect, it } from 'vitest';
import { HardwareMenu, type MenuTarget } from './HardwareMenu';
import type { GameState } from '../types';

/** A `GameManager` stand-in that only records what was asked of it. */
function target(state: GameState) {
  const calls = { pause: 0, uiSound: 0 };
  const menu: MenuTarget = {
    getState: () => state,
    pause: () => {
      calls.pause += 1;
    },
    uiSound: () => {
      calls.uiSound += 1;
    },
  };
  return { menu: new HardwareMenu(menu), calls };
}

// These run without a DOM, which is the point: the suite is headless, and a
// menu control that threw where there is no document would take the whole
// simulation down with it. What can be checked here is the one verb that is
// not DOM work — pause — and that everything else stays quiet.
describe('HardwareMenu', () => {
  it('pauses a fight in progress', () => {
    const { menu, calls } = target('PLAYING');

    menu.apply({ step: 0, press: true });
    expect(calls.pause).toBe(1);
  });

  it('does not pause from a menu, where the button presses a button instead', () => {
    for (const state of ['MENU', 'PAUSED', 'RESULTS'] as GameState[]) {
      const { menu, calls } = target(state);
      menu.apply({ step: 0, press: true });
      expect(calls.pause).toBe(0);
    }
  });

  it('does nothing at all with the stick', () => {
    const { menu, calls } = target('PLAYING');

    // The stick only ever moves the focus. There is no menu open during a
    // fight — and no document here — so both flicks land on nothing, which is
    // the behaviour a control that must not touch gameplay wants.
    menu.apply({ step: 1, press: false });
    menu.apply({ step: -1, press: false });
    expect(calls.pause).toBe(0);
    expect(calls.uiSound).toBe(0);
  });
});
