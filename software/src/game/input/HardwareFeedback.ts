import type { EventBus } from '../events';
import type { GameSnapshot } from '../GameManager';

/**
 * The output half of the hardware integration: the game announcing what just
 * happened so the controller can light up, buzz, and show it on the OLED.
 *
 * It is a *listener*, never a caller into gameplay. The simulation emits the
 * same events it already emits for the HUD; this translates the ones worth
 * feeling into a semantic kind and posts it to the bridge. Nothing here can
 * change the outcome of a round, and removing it removes only the feedback.
 *
 * The bridge decides what each kind does to the LED and buzzer — see FEEDBACK
 * in bridge.py — so re-tuning the hardware never means rebuilding the game.
 */

/** The vocabulary the bridge understands. Kept in step with FEEDBACK there. */
export type FeedbackKind =
  | 'correct'
  | 'wrong'
  | 'miss'
  | 'blocked'
  | 'hurt'
  | 'special'
  | 'letter'
  | 'collect'
  | 'crash'
  | 'countdown'
  | 'start'
  | 'win'
  | 'lose';

interface FeedbackPayload {
  kind: FeedbackKind;
  score?: number;
  combo?: number;
  hp?: number;
  monsterHp?: number;
  level?: number;
  state?: string;
  text?: string;
}

export interface HardwareFeedbackOptions {
  url?: string;
}

export class HardwareFeedback {
  private readonly url: string;
  private readonly bus: EventBus;
  private readonly getSnapshot: () => GameSnapshot;

  private unsubscribes: Array<() => void> = [];
  /**
   * At most one request in flight, with the newest undelivered payload held
   * behind it. A stalled bridge must not be able to grow an unbounded queue of
   * feedback that would then arrive long after the punches that caused it.
   */
  private inFlight = false;
  private pending: FeedbackPayload | null = null;

  constructor(
    bus: EventBus,
    getSnapshot: () => GameSnapshot,
    options: HardwareFeedbackOptions = {},
  ) {
    this.bus = bus;
    this.getSnapshot = getSnapshot;
    this.url = options.url ?? '/bridge/api/feedback';
  }

  start(): void {
    if (this.unsubscribes.length > 0) return;

    this.unsubscribes.push(
      this.bus.on('resolved', ({ outcome }) => {
        if (outcome === 'CORRECT') this.send('correct');
        else if (outcome === 'WRONG') this.send('wrong');
        else this.send('miss');
      }),

      this.bus.on('defense', ({ blocked }) => {
        this.send(blocked ? 'blocked' : 'hurt');
      }),

      this.bus.on('special', () => this.send('special')),

      this.bus.on('wordConnect', ({ type }) => {
        if (type === 'LETTER') this.send('letter');
        else if (type === 'FAIL') this.send('wrong');
      }),

      this.bus.on('kartChase', ({ type }) => {
        if (type === 'COLLECT') this.send('collect');
        else if (type === 'CRASH') this.send('crash');
      }),

      this.bus.on('countdown', ({ value }) => {
        this.send(value > 0 ? 'countdown' : 'start');
      }),

      this.bus.on('round', ({ outcome }) => {
        this.send(outcome === 'VICTORY' ? 'win' : outcome === 'DEFEAT' ? 'lose' : 'win');
      }),
    );
  }

  stop(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.pending = null;
  }

  private send(kind: FeedbackKind): void {
    // Every event carries the current numbers with it, so the OLED stays in
    // step without the game having to publish a second stream just for it.
    const snapshot = this.getSnapshot();
    this.post({
      kind,
      score: snapshot.stats.score,
      combo: snapshot.stats.combo,
      hp: snapshot.combat.playerHp,
      monsterHp: snapshot.combat.monsterHp,
      level: snapshot.combat.level,
      state: snapshot.state,
    });
  }

  private post(payload: FeedbackPayload): void {
    if (typeof fetch !== 'function') return;

    if (this.inFlight) {
      this.pending = payload;
      return;
    }

    this.inFlight = true;
    fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      // No bridge running is the normal case, not an error worth surfacing:
      // the game is fully playable on the keyboard alone.
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
        const next = this.pending;
        this.pending = null;
        if (next) this.post(next);
      });
  }
}
