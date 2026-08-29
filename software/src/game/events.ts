import type {
  HitQuality,
  MonsterPhase,
  Outcome,
  Question,
  RoundOutcome,
  TargetRuntime,
} from './types';

/** Why a question ended without a landed answer. */
export type MissReason =
  | 'ESCAPED'   // the row flew past untouched
  | 'POSITION'; // punched from outside the answer's standing position

/**
 * Everything the gameplay core announces to the presentation layer.
 * The scene/HUD subscribe to these; the core never imports React.
 */
export interface GameEvents {
  /** A new question + its three targets just spawned. */
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
    /** Set only when `outcome` is MISS. */
    missReason: MissReason | null;
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

  // ------------------------------------------------------------- combat --

  /** The monster took damage, from a landed answer or a special attack. */
  monsterDamage: {
    amount: number;
    hp: number;
    maxHp: number;
    special: boolean;
    lane: number | null;
  };
  /** The monster's phase changed; `chargeSeconds` is the wind-up length. */
  monsterPhase: { phase: MonsterPhase; chargeSeconds: number };
  /** The monster's blow resolved against the player's guard. */
  defense: { blocked: boolean; damage: number; playerHp: number };
  /** The player's guard went up. */
  guard: { raised: boolean };

  // -------------------------------------------------------- word connect --

  /** Progress through the earned mini game, worth a flash of feedback. */
  wordConnect: {
    type: 'START' | 'LETTER' | 'WORD' | 'FAIL' | 'END';
    letter: string | null;
    word: string;
    wordsCompleted: number;
  };
  /** The special attack fired. */
  special: { damage: number; wordsCompleted: number };

  // ---------------------------------------------------------- kart chase --

  /**
   * Progress through the chase. `WAVE` fires as a row enters the tunnel, which
   * is what the scene re-syncs its block list on.
   */
  kartChase: {
    type:
      | 'START'
      | 'WAVE'
      | 'COLLECT'
      | 'CRASH'
      | 'DODGE'
      | 'CAUGHT'
      | 'ESCAPED'
      /**
       * The chase is torn down and the road is empty. Fired *after* the
       * manager has cleared itself, which is what the scene needs: it mirrors
       * the live block list, and `CAUGHT`/`ESCAPED` still carry a full one so
       * the result can be read.
       */
      | 'END';
    /** The topic being driven through, e.g. "ANIMALS". */
    topic: string;
    /** The picture that just resolved, or null. */
    word: string | null;
    lane: number | null;
    collected: number;
    /** Distance still to close, 1 far, 0 caught. */
    gap: number;
    /** Damage dealt, set only on CAUGHT and ESCAPED. */
    damage: number;
  };

  /** The round finished, and why. */
  round: { outcome: RoundOutcome };

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
