import { describe, expect, it } from 'vitest';
import {
  DIRECTION_DEADZONE,
  GUARD_ACTIVE_SECONDS,
  GUARD_COOLDOWN_SECONDS,
  MONSTER_CHARGE_SECONDS,
  STANCE_TOLERANCE,
} from '../constants';
import { PlayerMotion } from './PlayerMotion';

/** Puts the player at an exact standing position without waiting for damping. */
function place(motion: PlayerMotion, x: number): void {
  motion.x = x;
}

/** Puts the hand at an exact reach without waiting for damping. */
function extend(motion: PlayerMotion, x: number, y: number): void {
  motion.handX = x;
  motion.handY = y;
}

describe('PlayerMotion stance', () => {
  it('reports the lane the player is standing in', () => {
    const motion = new PlayerMotion();

    place(motion, -1);
    expect(motion.stance).toBe(0);

    place(motion, 0);
    expect(motion.stance).toBe(1);

    place(motion, 1);
    expect(motion.stance).toBe(2);
  });

  it('is forgiving inside the tolerance and empty outside it', () => {
    const motion = new PlayerMotion();

    place(motion, -1 + STANCE_TOLERANCE * 0.9);
    expect(motion.stance).toBe(0);

    // Half way between LEFT and CENTER is deliberately no lane at all: a punch
    // from here is a miss, not a guess at the nearest answer.
    place(motion, -0.5);
    expect(motion.stance).toBeNull();
  });

  it('grades how solidly the player is planted', () => {
    const motion = new PlayerMotion();

    place(motion, 0);
    expect(motion.stanceStrength).toBe(1);

    place(motion, STANCE_TOLERANCE);
    expect(motion.stanceStrength).toBeCloseTo(0, 5);
  });

  it('walks under a held axis and stops at the edges', () => {
    const motion = new PlayerMotion();
    motion.setAxis(1, 0);
    for (let i = 0; i < 120; i += 1) motion.update(1 / 60, i / 60);
    expect(motion.x).toBe(1);
    expect(motion.stance).toBe(2);
  });

  it('lets a steering intent override an absolute target', () => {
    const motion = new PlayerMotion();
    motion.setAbsolute(1);
    motion.update(0.1, 0.1);
    const afterSnap = motion.x;
    expect(afterSnap).toBeGreaterThan(0);

    motion.setAxis(-1, 0);
    for (let i = 0; i < 60; i += 1) motion.update(1 / 60, 0.1 + i / 60);
    expect(motion.x).toBeLessThan(afterSnap);
  });
});

describe('PlayerMotion reach', () => {
  it('picks the dominant axis for the word-connect slots', () => {
    const motion = new PlayerMotion();

    extend(motion, 0, 1);
    expect(motion.direction).toBe('UP');
    expect(motion.slotIndex).toBe(0);

    extend(motion, 1, 0);
    expect(motion.direction).toBe('RIGHT');
    expect(motion.slotIndex).toBe(1);

    extend(motion, 0, -1);
    expect(motion.direction).toBe('DOWN');
    expect(motion.slotIndex).toBe(2);

    extend(motion, -1, 0);
    expect(motion.direction).toBe('LEFT');
    expect(motion.slotIndex).toBe(3);
  });

  it('reaches at nothing while the hand is still at rest', () => {
    const motion = new PlayerMotion();
    extend(motion, 0.1, 0.1);
    expect(motion.direction).toBeNull();
    expect(motion.slotIndex).toBeNull();
  });
});

describe('PlayerMotion guard', () => {
  it('holds only briefly, so blocking has to be timed', () => {
    const motion = new PlayerMotion();
    motion.update(0, 0);

    expect(motion.raiseGuard()).toBe(true);
    expect(motion.isGuarding()).toBe(true);

    motion.update(0, GUARD_ACTIVE_SECONDS - 0.05);
    expect(motion.isGuarding()).toBe(true);

    motion.update(0, GUARD_ACTIVE_SECONDS + 0.01);
    expect(motion.isGuarding()).toBe(false);
  });

  it('cannot be raised again until the cooldown has passed', () => {
    const motion = new PlayerMotion();
    motion.update(0, 0);
    motion.raiseGuard();

    motion.update(0, GUARD_ACTIVE_SECONDS + 0.1);
    expect(motion.raiseGuard()).toBe(false);

    motion.update(0, GUARD_ACTIVE_SECONDS + GUARD_COOLDOWN_SECONDS + 0.01);
    expect(motion.raiseGuard()).toBe(true);
  });

  it('has already dropped if it went up at the start of a wind-up', () => {
    // This is the whole point of the timer: holding block from the moment the
    // monster starts charging must not protect you when the blow lands.
    const motion = new PlayerMotion();
    motion.update(0, 0);
    motion.raiseGuard();

    expect(GUARD_ACTIVE_SECONDS).toBeLessThan(MONSTER_CHARGE_SECONDS);
    motion.update(0, MONSTER_CHARGE_SECONDS);
    expect(motion.isGuarding()).toBe(false);
  });
});

describe('PlayerMotion modes', () => {
  /** Runs the model forward the way the game loop does. */
  function run(motion: PlayerMotion, seconds: number): void {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i += 1) motion.update(1 / 60, i / 60);
  }

  it('sends the same movement signal to the feet or the hand', () => {
    const motion = new PlayerMotion();

    motion.setAxis(-1, 0);
    run(motion, 0.4);
    expect(motion.x).toBeLessThan(-DIRECTION_DEADZONE);
    expect(motion.handX).toBe(0);

    motion.setMode('REACH');
    motion.setAxis(-1, 0);
    run(motion, 0.4);
    expect(motion.handX).toBeLessThan(-DIRECTION_DEADZONE);
    expect(motion.direction).toBe('LEFT');
    expect(motion.x).toBeCloseTo(0, 2);
  });

  it('plants the feet in the centre for the whole of a reach', () => {
    const motion = new PlayerMotion();
    motion.setMode('REACH');

    // A snap key or a tracker that keeps reporting where the body is.
    motion.setAbsolute(1);
    run(motion, 0.5);

    expect(motion.x).toBeCloseTo(0, 2);
    expect(motion.stance).toBe(1);
  });

  it('starts a reach from rest, so the first letter costs a movement', () => {
    const motion = new PlayerMotion();
    motion.setReach(0, 1);
    run(motion, 0.3);
    expect(motion.slotIndex).not.toBeNull();

    motion.setMode('REACH');
    expect(motion.handX).toBe(0);
    expect(motion.handY).toBe(0);
    expect(motion.slotIndex).toBeNull();
  });

  it('swings between directions without having to cancel the old one', () => {
    const motion = new PlayerMotion();
    motion.setMode('REACH');

    motion.setReach(0, 1);
    run(motion, 0.3);
    expect(motion.direction).toBe('UP');

    motion.setReach(-1, 0);
    run(motion, 0.3);
    expect(motion.direction).toBe('LEFT');
  });

  it('returns the hand to guard when nothing is pushing it', () => {
    const motion = new PlayerMotion();
    motion.setMode('REACH');

    motion.setReach(1, 0);
    run(motion, 0.3);
    expect(motion.direction).toBe('RIGHT');

    motion.setReach(0, 0);
    run(motion, 0.6);
    expect(motion.direction).toBeNull();
    expect(motion.reachStrength).toBeLessThan(DIRECTION_DEADZONE);
  });

  it('gives the feet back when the mini game ends', () => {
    const motion = new PlayerMotion();
    motion.setMode('REACH');
    motion.setReach(-1, 0);
    run(motion, 0.3);

    motion.setMode('STANCE');
    expect(motion.handX).toBe(0);

    motion.setAbsolute(-1);
    run(motion, 0.5);
    expect(motion.stance).toBe(0);
  });
});
