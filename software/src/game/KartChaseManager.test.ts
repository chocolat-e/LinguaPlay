import { beforeEach, describe, expect, it } from 'vitest';
import { KartChaseManager, chaseDamage } from './KartChaseManager';
import { PICTURE_TOPICS } from './pictureBank';
import {
  KART_CATCH_TARGET,
  KART_DAMAGE_PER_PICTURE,
  KART_LEAD_IN,
  KART_RAM_DAMAGE,
  KART_WAVES,
} from './constants';
import type { KartBlockRuntime } from './types';

const FRAME = 1 / 60;
const TOPIC = PICTURE_TOPICS[0];

/** Drives the chase forward, holding one lane the whole way. */
function hold(kart: KartChaseManager, seconds: number, lane: number, from = 0): number {
  let t = from;
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    t += FRAME;
    kart.tick(FRAME, t, lane);
  }
  return t;
}

/** The row closest to the player that has not resolved yet. */
function nearestWave(kart: KartChaseManager): KartBlockRuntime[] {
  const incoming = kart.liveBlocks.filter((block) => block.state === 'INCOMING');
  if (incoming.length === 0) return [];
  const id = Math.min(...incoming.map((block) => block.waveId));
  return incoming.filter((block) => block.waveId === id);
}

/** Plays the chase out, always steering at the kind of picture asked for. */
function drive(kart: KartChaseManager, pick: 'match' | 'decoy'): void {
  let t = 0;
  let lane = 1;
  for (let frame = 0; frame < 3000 && kart.active; frame += 1) {
    const wave = nearestWave(kart);
    const wanted = wave.find((block) => block.onTopic === (pick === 'match'));
    if (wanted) lane = wanted.lane;
    t += FRAME;
    kart.tick(FRAME, t, lane);
  }
}

describe('kart chase: rows of pictures', () => {
  let kart: KartChaseManager;

  beforeEach(() => {
    kart = new KartChaseManager();
    kart.start(TOPIC, KART_WAVES);
  });

  it('holds the road empty through the lead-in, so the topic can be read', () => {
    hold(kart, KART_LEAD_IN * 0.5, 1);
    expect(kart.liveBlocks).toHaveLength(0);

    hold(kart, KART_LEAD_IN, 1);
    expect(kart.liveBlocks.length).toBeGreaterThan(0);
  });

  it('starts the chase at full distance', () => {
    const snapshot = kart.snapshot();
    expect(snapshot.active).toBe(true);
    expect(snapshot.topic).toBe(TOPIC.label);
    expect(snapshot.gap).toBe(1);
    expect(snapshot.totalWaves).toBe(KART_WAVES);
  });

  it('builds every row the same way: one right, one wrong, one gap', () => {
    // The shape never varies. A row that sometimes holds two right answers and
    // sometimes fills all three lanes makes the player work out what kind of
    // row it is before they can start reading it.
    hold(kart, 30, 1);

    const waves = new Map<number, KartBlockRuntime[]>();
    for (const block of kart.liveBlocks) {
      const row = waves.get(block.waveId) ?? [];
      row.push(block);
      waves.set(block.waveId, row);
    }

    expect(waves.size).toBeGreaterThan(0);
    for (const [id, row] of waves) {
      expect(row.length, `row ${id} leaves one lane empty`).toBe(2);
      expect(row.filter((b) => b.onTopic).length, `row ${id} matches`).toBe(1);
      expect(row.filter((b) => !b.onTopic).length, `row ${id} decoys`).toBe(1);
      // One lane never holds two pictures.
      expect(new Set(row.map((block) => block.lane)).size).toBe(row.length);
    }
  });

  it('always leaves a way out for a word the player does not know', () => {
    hold(kart, 30, 1);

    const waves = new Map<number, Set<number>>();
    for (const block of kart.liveBlocks) {
      const lanes = waves.get(block.waveId) ?? new Set<number>();
      lanes.add(block.lane);
      waves.set(block.waveId, lanes);
    }

    for (const [id, lanes] of waves) {
      const empty = [0, 1, 2].filter((lane) => !lanes.has(lane));
      expect(empty.length, `row ${id} has exactly one gap`).toBe(1);
    }
  });

  it('never shows a picture from the topic as a decoy', () => {
    hold(kart, 30, 1);

    const words = new Set(TOPIC.items.map((item) => item.word));
    for (const block of kart.liveBlocks) {
      expect(words.has(block.word), `${block.word} on topic`).toBe(block.onTopic);
    }
  });

  it('closes the gap on every right picture, with no punch at all', () => {
    drive(kart, 'match');

    expect(kart.collected).toBeGreaterThanOrEqual(KART_CATCH_TARGET);
    expect(kart.crashed).toBe(0);
    expect(kart.caught).toBe(true);
  });

  it('ends the moment the gap closes, without running the rows that are left', () => {
    drive(kart, 'match');

    // Exactly the target, not every row in the chase — once the kart is
    // alongside there is nothing left to chase.
    expect(kart.collected).toBe(KART_CATCH_TARGET);
    expect(KART_CATCH_TARGET).toBeLessThan(KART_WAVES);
  });

  it('loses ground on every wrong picture', () => {
    drive(kart, 'decoy');

    expect(kart.crashed).toBe(KART_WAVES);
    expect(kart.collected).toBe(0);
    expect(kart.caught).toBe(false);
  });

  it('lets a crash give back a picture already banked', () => {
    // One row taken cleanly, then one row crashed, is back to nothing.
    let t = 0;
    let lane = 1;
    let taken = 0;
    for (let frame = 0; frame < 3000 && kart.active && taken < 2; frame += 1) {
      const wave = nearestWave(kart);
      if (wave.length > 0) {
        const wanted = wave.find((block) => block.onTopic === (taken === 0));
        if (wanted) lane = wanted.lane;
      }
      const before = kart.collected + kart.crashed;
      t += FRAME;
      kart.tick(FRAME, t, lane);
      if (kart.collected + kart.crashed > before) taken += 1;
    }

    expect(kart.collected).toBe(1);
    expect(kart.crashed).toBe(1);
    expect(kart.progress).toBe(0);
    expect(kart.gap).toBe(1);
  });

  it('reports every row it resolves, once', () => {
    let t = 0;
    const outcomes: string[] = [];
    for (let frame = 0; frame < 3000 && kart.active; frame += 1) {
      t += FRAME;
      kart.tick(FRAME, t, 1);
      for (const result of kart.drainResults()) outcomes.push(result.outcome);
    }

    // One result per row, and nothing but the three things a row can be.
    expect(outcomes).toHaveLength(KART_WAVES);
    for (const outcome of outcomes) {
      expect(['COLLECT', 'CRASH', 'DODGE']).toContain(outcome);
    }
  });

  it('leaves nothing behind once it is over', () => {
    drive(kart, 'decoy');

    expect(kart.active).toBe(false);
    expect(kart.status).toBe('DONE');
    expect(kart.snapshot().active).toBe(false);
  });
});

describe('what the chase is worth', () => {
  it('pays per picture, and pays extra for actually catching it', () => {
    expect(chaseDamage(0, false)).toBe(0);
    expect(chaseDamage(3, false)).toBe(3 * KART_DAMAGE_PER_PICTURE);
    expect(chaseDamage(5, true)).toBe(5 * KART_DAMAGE_PER_PICTURE + KART_RAM_DAMAGE);
  });

  it('is always better to catch it than to let it go', () => {
    expect(chaseDamage(KART_CATCH_TARGET, true)).toBeGreaterThan(
      chaseDamage(KART_CATCH_TARGET, false),
    );
  });
});
