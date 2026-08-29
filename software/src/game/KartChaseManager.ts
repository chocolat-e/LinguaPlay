import {
  KART_BLOCK_SPEED,
  KART_CATCH_TARGET,
  KART_CRASH_COST,
  KART_DAMAGE_PER_PICTURE,
  KART_DESPAWN_Z,
  KART_LEAD_IN,
  KART_RAM_DAMAGE,
  KART_SPAWN_Z,
  KART_TAIL,
  KART_WAVE_INTERVAL,
  STRIKE_Z,
} from './constants';
import { pickDecoys, pickMatches, type PictureItem, type PictureTopic } from './pictureBank';
import type { KartBlockRuntime, KartChaseSnapshot, KartChaseStatus } from './types';

/** What one row of pictures was worth as it went past. */
export type KartGateOutcome =
  | 'COLLECT' // drove through a picture that was on topic
  | 'CRASH'   // drove through one that was not
  | 'DODGE';  // drove through the empty lane

export interface KartGateResult {
  outcome: KartGateOutcome;
  lane: number;
  /** The picture that resolved, or null when the lane was empty. */
  word: string | null;
  emoji: string | null;
}

/** One row, planned at the start and spawned on the clock. */
interface WavePlan {
  /** Pictures by lane; a null lane is a gap in the row. */
  lanes: Array<{ item: PictureItem; onTopic: boolean } | null>;
}

/** A row in the air, holding the same block objects the scene renders. */
interface LiveWave {
  id: number;
  z: number;
  resolved: boolean;
  blocks: KartBlockRuntime[];
}

const IDLE_SNAPSHOT: KartChaseSnapshot = {
  active: false,
  topic: '',
  collected: 0,
  crashed: 0,
  waveIndex: 0,
  totalWaves: 0,
  gap: 1,
  status: 'DONE',
};

const NO_RESULTS: KartGateResult[] = [];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The chase: the wounded monster runs, and the player drives after it.
 *
 * The third mini game, and the only one that never asks for a punch. Rows of
 * pictures come down the same tunnel the answer blocks use, and the lane the
 * kart happens to be in when a row arrives *is* the answer — drive through a
 * picture that belongs to the topic and the gap closes, drive through one that
 * does not and it opens back up.
 *
 * That makes it the opposite of both existing games. Answering is move, then
 * commit with a punch; Word Connect is reach, which commits on its own but only
 * on the frame the hand crosses into a new slot. Here nothing the player does
 * commits anything — the row arriving does, on its own schedule, whether they
 * are ready or not. Steering is the whole of the input, which is exactly the
 * shape an accelerometer tilt produces.
 */
export class KartChaseManager {
  /** Every block spawned this chase, resolved ones included. Read by the scene. */
  private blocks: KartBlockRuntime[] = [];
  private waves: LiveWave[] = [];
  private plans: WavePlan[] = [];

  private topicLabel = '';
  private speed = KART_BLOCK_SPEED;
  private clock = 0;
  private nextWaveAt = 0;
  private spawned = 0;
  private resolved = 0;
  private collectedCount = 0;
  private crashedCount = 0;
  private tail = 0;
  private state: KartChaseStatus = 'DONE';
  private nextId = 1;
  private results: KartGateResult[] = [];
  private spawnedThisTick = false;

  get active(): boolean {
    return this.state !== 'DONE';
  }

  get status(): KartChaseStatus {
    return this.state;
  }

  get topic(): string {
    return this.topicLabel;
  }

  get collected(): number {
    return this.collectedCount;
  }

  get crashed(): number {
    return this.crashedCount;
  }

  /** True on the frame a new row entered the tunnel, so the scene can re-sync. */
  get justSpawned(): boolean {
    return this.spawnedThisTick;
  }

  /** The live block list. Read per frame by the scene; never rebuilt here. */
  get liveBlocks(): readonly KartBlockRuntime[] {
    return this.blocks;
  }

  /** Net pictures banked, clamped to the target. */
  get progress(): number {
    return clamp(
      this.collectedCount - this.crashedCount * KART_CRASH_COST,
      0,
      KART_CATCH_TARGET,
    );
  }

  /** Distance still to close: 1 is far behind, 0 is alongside. */
  get gap(): number {
    return 1 - this.progress / KART_CATCH_TARGET;
  }

  get caught(): boolean {
    return this.progress >= KART_CATCH_TARGET;
  }

  /**
   * @param waves how many rows of pictures the chase is worth.
   * @param speedScale the player's speed setting, so the chase respects it too.
   */
  start(topic: PictureTopic, waves: number, speedScale = 1): void {
    this.reset();
    this.topicLabel = topic.label;
    this.speed = KART_BLOCK_SPEED * Math.max(0.4, speedScale);
    this.plans = Array.from({ length: waves }, () => planWave(topic));
    this.nextWaveAt = KART_LEAD_IN;
    this.state = 'DRIVING';
  }

  /**
   * Advance the chase.
   *
   * @param lane which of the three lanes the kart is in. Never null — a kart is
   *   always somewhere on the road, so `PlayerMotion.lane` rounds to the nearest
   *   one rather than reporting a gap the way `stance` does for answering.
   * @param elapsed the simulation clock, for block state times.
   * @returns 'DONE' once the chase is over and the hit should land.
   */
  tick(dt: number, elapsed: number, lane: number): 'CONTINUE' | 'DONE' {
    this.spawnedThisTick = false;
    if (this.state === 'DONE') return 'DONE';

    this.clock += dt;

    if (this.state === 'DRIVING') {
      this.spawnDueWaves(elapsed);
      this.advance(dt);
      this.resolveArrivals(elapsed, lane);
      // Catching it early ends the chase there and then: once the kart is
      // alongside, there is nothing left to chase.
      if (this.caught) this.finish('CAUGHT');
      else if (this.resolved >= this.plans.length) this.finish('ESCAPED');
      return 'CONTINUE';
    }

    // CAUGHT / ESCAPED: the rows already in the air keep flying past while the
    // result is on screen, so the chase does not stop dead on the last gate.
    this.advance(dt);
    this.tail -= dt;
    if (this.tail > 0) return 'CONTINUE';
    this.state = 'DONE';
    return 'DONE';
  }

  /**
   * Rows that resolved since the last call.
   *
   * Drained rather than reported through a callback so the manager stays free
   * of anything that could reach back into `GameManager` mid-tick.
   */
  drainResults(): KartGateResult[] {
    if (this.results.length === 0) return NO_RESULTS;
    const out = this.results;
    this.results = [];
    return out;
  }

  snapshot(): KartChaseSnapshot {
    if (!this.active) return IDLE_SNAPSHOT;
    return {
      active: true,
      topic: this.topicLabel,
      collected: this.collectedCount,
      crashed: this.crashedCount,
      waveIndex: this.resolved,
      totalWaves: this.plans.length,
      gap: this.gap,
      status: this.state,
    };
  }

  reset(): void {
    this.blocks = [];
    this.waves = [];
    this.plans = [];
    this.topicLabel = '';
    this.speed = KART_BLOCK_SPEED;
    this.clock = 0;
    this.nextWaveAt = 0;
    this.spawned = 0;
    this.resolved = 0;
    this.collectedCount = 0;
    this.crashedCount = 0;
    this.tail = 0;
    this.state = 'DONE';
    this.results = [];
    this.spawnedThisTick = false;
  }

  // --------------------------------------------------------------- internals --

  private spawnDueWaves(elapsed: number): void {
    while (this.spawned < this.plans.length && this.clock >= this.nextWaveAt) {
      const plan = this.plans[this.spawned];
      const id = this.spawned + 1;
      const blocks: KartBlockRuntime[] = [];

      plan.lanes.forEach((entry, lane) => {
        if (!entry) return;
        const block: KartBlockRuntime = {
          id: this.nextId++,
          waveId: id,
          lane,
          emoji: entry.item.emoji,
          word: entry.item.word,
          onTopic: entry.onTopic,
          z: KART_SPAWN_Z,
          state: 'INCOMING',
          stateTime: elapsed,
        };
        blocks.push(block);
        this.blocks.push(block);
      });

      this.waves.push({ id, z: KART_SPAWN_Z, resolved: false, blocks });
      this.spawned += 1;
      this.nextWaveAt += KART_WAVE_INTERVAL;
      this.spawnedThisTick = true;
    }
  }

  /** Rows fly at a constant speed, then stop once they are behind the player. */
  private advance(dt: number): void {
    for (const wave of this.waves) {
      if (wave.z >= KART_DESPAWN_Z) continue;
      wave.z += this.speed * dt;
      for (const block of wave.blocks) block.z = wave.z;
    }
  }

  private resolveArrivals(elapsed: number, lane: number): void {
    for (const wave of this.waves) {
      if (wave.resolved || wave.z < STRIKE_Z) continue;
      wave.resolved = true;
      this.resolved += 1;

      const hit = wave.blocks.find((block) => block.lane === lane) ?? null;

      for (const block of wave.blocks) {
        block.state =
          block === hit ? (block.onTopic ? 'COLLECTED' : 'CRASHED') : 'MISSED';
        block.stateTime = elapsed;
      }

      if (!hit) {
        this.results.push({ outcome: 'DODGE', lane, word: null, emoji: null });
        continue;
      }
      if (hit.onTopic) this.collectedCount += 1;
      else this.crashedCount += 1;
      this.results.push({
        outcome: hit.onTopic ? 'COLLECT' : 'CRASH',
        lane,
        word: hit.word,
        emoji: hit.emoji,
      });
    }
  }

  private finish(state: 'CAUGHT' | 'ESCAPED'): void {
    this.state = state;
    this.tail = KART_TAIL;
    // Nothing else spawns once the chase is decided.
    this.plans = this.plans.slice(0, this.spawned);
  }
}

/**
 * One row of pictures: **exactly one right, one wrong, one empty lane.**
 *
 * The shape never varies, and that is the point. An earlier version drew one or
 * two matches and one or two decoys at random, so a row might hold two right
 * answers, or fill all three lanes, or leave a gap — and the player had to work
 * out what kind of row they were looking at before they could even start
 * reading it. "Which of these two correct ones is the answer?" is not a
 * question this game ever meant to ask.
 *
 * With a fixed shape there is one thing to find, one thing to avoid, and one
 * way out. The empty lane is what keeps that from being a coin flip: a word you
 * do not know costs you nothing if you take the gap, so "never crash" and
 * "actually catch it" stay different strategies.
 */
function planWave(topic: PictureTopic): WavePlan {
  const entries: Array<{ item: PictureItem; onTopic: boolean }> = [
    ...pickMatches(topic, 1).map((item) => ({ item, onTopic: true })),
    ...pickDecoys(topic, 1).map((item) => ({ item, onTopic: false })),
  ];

  const lanes: WavePlan['lanes'] = [null, null, null];
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  entries.forEach((entry, index) => {
    lanes[order[index]] = entry;
  });
  return { lanes };
}

/** What the chase was worth: every picture banked, plus catching it at all. */
export function chaseDamage(collected: number, caught: boolean): number {
  return collected * KART_DAMAGE_PER_PICTURE + (caught ? KART_RAM_DAMAGE : 0);
}
