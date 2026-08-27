import type { HitQuality, Outcome, Question, TargetRuntime } from './types';

/**
 * Everything the gameplay core announces to the presentation layer.
 * The scene/HUD subscribe to these; the core never imports React.
 */
export interface GameEvents {
  /** A new question + its four targets just spawned. */
  question: { question: Question; targets: TargetRuntime[]; index: number };
  /** A punch resolved a question (or a target flew past). */
  resolved: {
    outcome: Outcome;
    quality: HitQuality | null;
    lane: number | null;
    correctLane: number;
    points: number;
    combo: number;
    multiplier: number;
  };
  /** Any punch at all — used to animate the player's gloves. */
  punch: { hand: 'left' | 'right' | 'unknown'; lane: number | null };
  /** A punch that did not connect with any live target. */
  whiff: { lane: number | null };
  /** Spawn a particle burst in the 3D scene. */
  impact: { x: number; y: number; z: number; color: string; power: number };
  /** Countdown ticked: 3, 2, 1, then 0 meaning "GO!". */
  countdown: { value: number };
  /** Rhythm pulse from the music clock, for scene-wide beat animation. */
  beat: { index: number };
  /** Adaptive difficulty stepped up or down. */
  difficulty: { from: string; to: string; direction: 'up' | 'down' };
  /** Any change worth repainting the HUD for. */
  stats: Record<string, never>;
  state: { state: string };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

/** Minimal typed pub/sub. Deliberately dependency-free. */
export class EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type as string);
    if (!set) {
      set = new Set();
      this.handlers.set(type as string, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => this.off(type, handler);
  }

  off<K extends keyof GameEvents>(type: K, handler: Handler<K>): void {
    this.handlers.get(type as string)?.delete(handler as (payload: unknown) => void);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type as string);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
