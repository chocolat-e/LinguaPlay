import { beforeEach, describe, expect, it } from 'vitest';
import { GameManager } from './GameManager';
import QUESTIONS from '../data/questions';
import {
  COUNTDOWN_SECONDS,
  DIRECTION_DEADZONE,
  GUARD_ACTIVE_SECONDS,
  KART_CHASE_HP_TRIGGERS,
  MONSTER_CHARGE_SECONDS,
  PLAYER_HIT_DAMAGE,
  RESOLVE_DELAY,
  SLOT_DIRECTIONS,
  SPECIAL_HITS_PER_WORD,
  SPECIAL_WINDUP_SECONDS,
  WORD_CONNECT_GAP,
  WORD_CONNECT_SECONDS,
  WORD_CONNECT_STREAK,
  WORD_CONNECT_WORDS,
} from './constants';
import type { KartBlockRuntime, MoveDirection } from './types';

const FRAME = 1 / 60;

/** Comfortably longer than a whole special attack, slow motion included. */
const SPECIAL_SEQUENCE = 6;

/** Runs the simulation forward, the way the render loop does. */
function advance(game: GameManager, seconds: number): void {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) game.tick(FRAME);
}

/** Starts a round and runs the countdown out so the first question is live. */
function startRound(game: GameManager): void {
  game.startCountdown();
  advance(game, COUNTDOWN_SECONDS + 0.2);
}

/** Walks to a lane and waits until the player is actually standing there. */
function moveTo(game: GameManager, lane: 0 | 1 | 2): void {
  game.input.motion.setAbsolute([-1, 0, 1][lane]);
  advance(game, 0.5);
}

const AXIS: Record<MoveDirection, [number, number]> = {
  UP: [0, 1],
  RIGHT: [1, 0],
  DOWN: [0, -1],
  LEFT: [-1, 0],
};

/** Reaches the hand at one of the four word-connect slots. The feet never move. */
function face(game: GameManager, direction: MoveDirection): void {
  const [x, y] = AXIS[direction];
  game.input.motion.setReach(x, y);
  advance(game, 0.45);
}

function punch(game: GameManager): void {
  game.input.punch({ laneIndex: null, source: 'keyboard' });
}

/** The lane holding the correct answer for the question currently on screen. */
function correctLane(game: GameManager): 0 | 1 | 2 {
  const question = game.getSnapshot().question;
  if (!question) throw new Error('No question is live.');
  return question.correctAnswer as 0 | 1 | 2;
}

function wrongLane(game: GameManager): 0 | 1 | 2 {
  const correct = correctLane(game);
  return ([0, 1, 2] as const).find((lane) => lane !== correct) as 0 | 1 | 2;
}

/** Answers the live question correctly, then waits for the next one. */
function answerCorrectly(game: GameManager): void {
  moveTo(game, correctLane(game));
  punch(game);
}

/** Puts the player on level 2+, where the monster is allowed to hit back. */
function promoteToLevelTwo(game: GameManager): void {
  game.learner.completeSession();
}

/** Runs a round up to the point where the Word Connect mini game opens. */
function enterWordConnect(game: GameManager): void {
  startRound(game);
  for (let i = 0; i < WORD_CONNECT_STREAK; i += 1) {
    answerCorrectly(game);
    if (game.getSnapshot().combat.phase === 'WORD_CONNECT') return;
    advance(game, 2.5);
  }
}

/** Drops the hand back to guard, so the next reach reads as a new one. */
function restHand(game: GameManager): void {
  game.input.motion.setReach(0, 0);
  advance(game, 0.6);
}

/** The slot holding the letter the current word needs next. */
function nextSlot(game: GameManager): number {
  const needed = game.wordConnect.currentWord[game.wordConnect.snapshot().progress];
  const slot = game.wordConnect.liveSlots.find(
    (entry) => entry.letter === needed && entry.usedAt === null,
  );
  if (!slot) throw new Error(`No slot holds ${needed}.`);
  return slot.index;
}

describe('answering: move, then punch', () => {
  let game: GameManager;

  beforeEach(() => {
    game = new GameManager();
  });

  it('serves exactly three answers, one per standing position', () => {
    startRound(game);
    expect(game.targets).toHaveLength(3);
    expect(game.getSnapshot().question?.answers).toHaveLength(3);
    expect(game.targets.map((target) => target.lane).sort()).toEqual([0, 1, 2]);
  });

  // Scenario 1
  it('counts a punch thrown from the correct answer and damages the monster', () => {
    startRound(game);
    const before = game.monster.hp;

    answerCorrectly(game);

    const snapshot = game.getSnapshot();
    expect(snapshot.lastOutcome?.outcome).toBe('CORRECT');
    expect(snapshot.stats.correct).toBe(1);
    expect(snapshot.combat.correctStreak).toBe(1);
    expect(game.monster.hp).toBeLessThan(before);
  });

  // Scenario 2
  it('treats a punch from the wrong position as a MISS and resets the streak', () => {
    startRound(game);
    answerCorrectly(game);
    advance(game, 2);
    expect(game.getSnapshot().combat.correctStreak).toBe(1);

    // Stand in one lane while a different answer is the one being aimed at.
    const correct = correctLane(game);
    moveTo(game, ([0, 1, 2] as const).find((lane) => lane !== correct) as 0 | 1 | 2);
    const hp = game.monster.hp;
    game.input.punch({ laneIndex: correct, source: 'mouse' });

    const snapshot = game.getSnapshot();
    expect(snapshot.lastOutcome?.outcome).toBe('MISS');
    expect(snapshot.stats.missed).toBe(1);
    expect(snapshot.combat.correctStreak).toBe(0);
    expect(game.monster.hp).toBe(hp);
  });

  it('misses when the punch is thrown from between two lanes', () => {
    startRound(game);
    game.input.motion.setAbsolute(-0.5);
    advance(game, 0.5);
    expect(game.input.stance).toBeNull();

    punch(game);
    expect(game.getSnapshot().lastOutcome?.outcome).toBe('MISS');
  });

  // Scenario 3
  it('submits nothing when the player moves but never punches', () => {
    startRound(game);
    moveTo(game, correctLane(game));
    advance(game, 1.2);

    const snapshot = game.getSnapshot();
    expect(snapshot.stats.answered).toBe(0);
    expect(snapshot.lastOutcome).toBeNull();
    expect(snapshot.combat.phase).toBe('ANSWERING');
  });

  // Scenario 4
  it('answers wrongly and records it without a counter-attack on level 1', () => {
    startRound(game);
    expect(game.getSnapshot().combat.level).toBe(1);

    moveTo(game, wrongLane(game));
    punch(game);

    const snapshot = game.getSnapshot();
    expect(snapshot.lastOutcome?.outcome).toBe('WRONG');
    expect(snapshot.stats.wrong).toBe(1);
    expect(snapshot.combat.phase).toBe('RESOLVING');
    expect(snapshot.combat.monsterPhase).not.toBe('CHARGING');
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp);
  });

  it('keeps feeding the adaptive difficulty model through the new flow', () => {
    startRound(game);
    answerCorrectly(game);
    advance(game, 2.5);

    const record = game.score.history[0];
    expect(record.outcome).toBe('CORRECT');
    expect(record.reactionTime).toBeGreaterThan(0);
    expect(record.knowledgeComponent).toBeTruthy();
    expect(game.difficulty.rollingAccuracy).toBe(1);
  });
});

describe('monster attacks from level 2', () => {
  let game: GameManager;

  beforeEach(() => {
    game = new GameManager();
    promoteToLevelTwo(game);
  });

  // Scenario 5
  it('winds up an attack after a wrong answer', () => {
    startRound(game);
    expect(game.getSnapshot().combat.level).toBeGreaterThan(1);

    moveTo(game, wrongLane(game));
    punch(game);

    const snapshot = game.getSnapshot();
    expect(snapshot.combat.phase).toBe('MONSTER_CHARGING');
    expect(snapshot.combat.monsterPhase).toBe('CHARGING');
    expect(snapshot.combat.chargeRemaining).toBeGreaterThan(0);
  });

  it('winds up an attack after a miss, too', () => {
    startRound(game);
    game.input.motion.setAbsolute(-0.5);
    advance(game, 0.5);
    punch(game);

    expect(game.getSnapshot().combat.phase).toBe('MONSTER_CHARGING');
  });

  // Scenario 6
  it('blocks for free when the guard goes up inside the window', () => {
    startRound(game);
    const blows: Array<{ blocked: boolean; damage: number }> = [];
    game.bus.on('defense', (payload) => blows.push(payload));

    moveTo(game, wrongLane(game));
    punch(game);

    // Wait until the blow is nearly here, then raise the guard.
    advance(game, MONSTER_CHARGE_SECONDS - GUARD_ACTIVE_SECONDS * 0.5);
    expect(game.input.motion.raiseGuard()).toBe(true);
    advance(game, GUARD_ACTIVE_SECONDS);

    // The blow really did land — it was simply blocked.
    expect(blows).toEqual([{ blocked: true, damage: 0, playerHp: 100 }]);
    const snapshot = game.getSnapshot();
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp);
    expect(snapshot.combat.phase).not.toBe('MONSTER_CHARGING');
  });

  // Scenario 7
  it('costs health when the guard is never raised', () => {
    startRound(game);
    moveTo(game, wrongLane(game));
    punch(game);
    advance(game, MONSTER_CHARGE_SECONDS + 0.2);

    const snapshot = game.getSnapshot();
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp - PLAYER_HIT_DAMAGE);
  });

  it('costs health when the guard is raised far too early', () => {
    startRound(game);
    moveTo(game, wrongLane(game));
    punch(game);

    // Blocking the instant the wind-up starts must not protect you: the guard
    // has already dropped by the time the blow lands.
    expect(game.input.motion.raiseGuard()).toBe(true);
    advance(game, MONSTER_CHARGE_SECONDS + 0.2);

    const snapshot = game.getSnapshot();
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp - PLAYER_HIT_DAMAGE);
  });

  it('returns to answering after the strike resolves', () => {
    startRound(game);
    moveTo(game, wrongLane(game));
    punch(game);
    advance(game, MONSTER_CHARGE_SECONDS + 3);

    expect(game.getSnapshot().combat.phase).toBe('ANSWERING');
    expect(game.targets.length).toBe(3);
  });

  // Scenario 10
  it('ends the round in defeat once health runs out', () => {
    startRound(game);
    const hits = Math.ceil(game.getSnapshot().combat.playerMaxHp / PLAYER_HIT_DAMAGE);

    for (let i = 0; i < hits; i += 1) {
      if (game.getState() !== 'PLAYING') break;
      moveTo(game, wrongLane(game));
      punch(game);
      advance(game, MONSTER_CHARGE_SECONDS + 3);
    }

    const snapshot = game.getSnapshot();
    expect(snapshot.combat.playerHp).toBeLessThanOrEqual(0);
    expect(snapshot.combat.roundOutcome).toBe('DEFEAT');
    expect(['GAME_OVER', 'RESULTS']).toContain(snapshot.state);
  });
});

describe('the diagnostic first level', () => {
  /** A game whose next round is played at `level`. */
  function atLevel(level: number): GameManager {
    const game = new GameManager();
    for (let i = 1; i < level; i += 1) game.learner.completeSession();
    return game;
  }

  /** Answers with a real, landed, wrong choice. */
  function answerWrongly(game: GameManager): void {
    moveTo(game, wrongLane(game));
    punch(game);
  }

  /** Punches from between lanes, which resolves as a MISS. */
  function missTheAnswer(game: GameManager): void {
    game.input.motion.setAbsolute(-0.5);
    advance(game, 0.5);
    punch(game);
  }

  const PAST_A_WIND_UP = MONSTER_CHARGE_SECONDS + 3;

  it('takes no revenge for a wrong answer on level 1', () => {
    const game = atLevel(1);
    startRound(game);
    expect(game.getSnapshot().combat.level).toBe(1);

    answerWrongly(game);
    expect(game.getSnapshot().combat.phase).toBe('RESOLVING');

    advance(game, PAST_A_WIND_UP);
    const snapshot = game.getSnapshot();
    expect(snapshot.stats.wrong).toBe(1);
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp);
    expect(snapshot.combat.monsterPhase).not.toBe('CHARGING');
    expect(snapshot.combat.monsterPhase).not.toBe('STRIKING');
  });

  it('takes no revenge for a miss on level 1 either', () => {
    const game = atLevel(1);
    startRound(game);

    missTheAnswer(game);
    expect(game.getSnapshot().lastOutcome?.outcome).toBe('MISS');
    expect(game.getSnapshot().combat.phase).toBe('RESOLVING');

    advance(game, PAST_A_WIND_UP);
    const snapshot = game.getSnapshot();
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp);
  });

  it('leaves the player at full health across a whole level 1 of mistakes', () => {
    const game = atLevel(1);
    startRound(game);

    for (let i = 0; i < 6; i += 1) {
      if (game.getSnapshot().combat.phase !== 'ANSWERING') advance(game, 2.5);
      if (game.getSnapshot().combat.phase !== 'ANSWERING') continue;
      // Alternate the two ways of failing a question.
      if (i % 2 === 0) answerWrongly(game);
      else missTheAnswer(game);
      advance(game, 2.5);
    }

    const snapshot = game.getSnapshot();
    expect(snapshot.stats.wrong + snapshot.stats.missed).toBeGreaterThanOrEqual(5);
    expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp);
    expect(snapshot.combat.diagnostic).toBe(true);
  });

  it('still lets level 1 damage the monster, so it measures without punishing', () => {
    const game = atLevel(1);
    startRound(game);
    const before = game.monster.hp;

    answerCorrectly(game);

    expect(game.monster.hp).toBeLessThan(before);
  });

  // "From the second level till the end" — not just level 2.
  for (const level of [2, 3, 4]) {
    it(`counter-attacks a wrong answer on level ${level}`, () => {
      const game = atLevel(level);
      startRound(game);
      expect(game.getSnapshot().combat.level).toBe(level);
      expect(game.getSnapshot().combat.diagnostic).toBe(false);

      answerWrongly(game);
      expect(game.getSnapshot().combat.phase).toBe('MONSTER_CHARGING');

      advance(game, PAST_A_WIND_UP);
      const snapshot = game.getSnapshot();
      expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp - PLAYER_HIT_DAMAGE);
    });

    it(`counter-attacks a miss on level ${level}`, () => {
      const game = atLevel(level);
      startRound(game);

      missTheAnswer(game);
      expect(game.getSnapshot().combat.phase).toBe('MONSTER_CHARGING');

      advance(game, PAST_A_WIND_UP);
      const snapshot = game.getSnapshot();
      expect(snapshot.combat.playerHp).toBe(snapshot.combat.playerMaxHp - PLAYER_HIT_DAMAGE);
    });
  }

  it('promotes the player out of the diagnostic level once a round is finished', () => {
    const game = atLevel(1);
    startRound(game);
    expect(game.getSnapshot().combat.level).toBe(1);

    // Finishing a round is what advances the level.
    game.learner.completeSession();
    game.startCountdown();
    advance(game, COUNTDOWN_SECONDS + 0.2);

    expect(game.getSnapshot().combat.level).toBe(2);
    expect(game.getSnapshot().combat.diagnostic).toBe(false);
  });
});

describe('word connect special attack', () => {
  let game: GameManager;

  beforeEach(() => {
    game = new GameManager();
  });

  // Scenario 8
  it('starts after five correct answers in a row', () => {
    startRound(game);

    for (let i = 0; i < WORD_CONNECT_STREAK; i += 1) {
      answerCorrectly(game);
      if (game.getSnapshot().combat.phase === 'WORD_CONNECT') break;
      advance(game, 2.5);
    }

    const snapshot = game.getSnapshot();
    expect(snapshot.combat.correctStreak).toBe(WORD_CONNECT_STREAK);
    expect(snapshot.combat.phase).toBe('WORD_CONNECT');
    expect(snapshot.wordConnect.active).toBe(true);
    expect(snapshot.wordConnect.word.length).toBeLessThanOrEqual(4);
  });

  // Scenario 9
  it('connects words for a heavy hit, then resets the streak', () => {
    startRound(game);
    for (let i = 0; i < WORD_CONNECT_STREAK; i += 1) {
      answerCorrectly(game);
      if (game.getSnapshot().combat.phase === 'WORD_CONNECT') break;
      advance(game, 2.5);
    }
    expect(game.getSnapshot().combat.phase).toBe('WORD_CONNECT');

    const hpBefore = game.monster.hp;
    const scoreBefore = game.getSnapshot().stats.score;

    // Play out every word: walk to each letter in order and punch it.
    let guard = 0;
    while (game.wordConnect.active && guard < 40) {
      guard += 1;
      const word = game.wordConnect.currentWord;
      const needed = word[game.wordConnect.snapshot().progress];
      const slot = game.wordConnect.liveSlots.find(
        (entry) => entry.letter === needed && entry.usedAt === null,
      );
      if (!slot) {
        advance(game, 0.3);
        continue;
      }
      face(game, SLOT_DIRECTIONS[slot.index]);
      punch(game);
      advance(game, 0.1);
    }

    advance(game, 0.5);
    expect(game.getSnapshot().combat.phase).toBe('SPECIAL_ATTACK');
    // Earned and spent, so the player can build another one.
    expect(game.getSnapshot().combat.correctStreak).toBe(0);

    // The blow is a sequence now, so let it play out before reading the damage.
    advance(game, SPECIAL_SEQUENCE);
    expect(game.monster.hp).toBeLessThan(hpBefore);
    expect(game.getSnapshot().stats.score).toBeGreaterThan(scoreBefore);
  });

  it('keeps the special attack out of the accuracy numbers', () => {
    startRound(game);
    for (let i = 0; i < WORD_CONNECT_STREAK; i += 1) {
      answerCorrectly(game);
      if (game.getSnapshot().combat.phase === 'WORD_CONNECT') break;
      advance(game, 2.5);
    }

    const before = game.getSnapshot().stats;
    advance(game, 30);
    const after = game.getSnapshot().stats;
    // The mini game answers no questions, so it changes no answer counts.
    expect(after.correct).toBe(before.correct);
    expect(after.wrong).toBe(before.wrong);
  });
});

describe('word connect is aimed with the hand alone', () => {
  let game: GameManager;

  beforeEach(() => {
    game = new GameManager();
    enterWordConnect(game);
    expect(game.getSnapshot().combat.phase).toBe('WORD_CONNECT');
  });

  it('plants the player in the centre with the hand at rest', () => {
    // The feet glide back from whichever lane answered the last question.
    advance(game, 0.4);
    expect(game.input.motion.x).toBeCloseTo(0, 2);
    expect(game.input.stance).toBe(1);
    // The first letter still costs a deliberate reach.
    expect(game.input.slotIndex).toBeNull();
  });

  it('keeps the feet centred however hard the body is pushed', () => {
    // A snap-to-lane key, or a pose tracker still streaming a chest position.
    game.input.motion.setAbsolute(-1);
    advance(game, 0.6);

    expect(game.input.motion.x).toBeCloseTo(0, 2);
    expect(game.input.stance).toBe(1);
  });

  it('steers the hand, not the body, from one movement signal', () => {
    advance(game, 0.4);
    game.input.motion.setAxis(-1, 0);
    advance(game, 0.3);

    expect(game.input.motion.handX).toBeLessThan(-DIRECTION_DEADZONE);
    expect(game.input.direction).toBe('LEFT');
    expect(game.input.motion.x).toBeCloseTo(0, 2);
    expect(game.input.stance).toBe(1);
  });

  it('swings straight from one direction to the next', () => {
    face(game, 'UP');
    expect(game.input.direction).toBe('UP');

    // An arm is a spring, not a cart: going from UP to LEFT is one movement,
    // not "cancel the up first, then go left".
    face(game, 'LEFT');
    expect(game.input.direction).toBe('LEFT');
  });

  it('falls back to guard when nothing is pushing the hand', () => {
    face(game, 'UP');
    expect(game.input.slotIndex).not.toBeNull();

    game.input.motion.setReach(0, 0);
    advance(game, 0.6);
    expect(game.input.slotIndex).toBeNull();
  });

  it('connects a letter on the reach alone, with no punch', () => {
    face(game, SLOT_DIRECTIONS[nextSlot(game)]);

    expect(game.wordConnect.snapshot().progress).toBe(1);
  });

  it('connects a whole word by reaching at its letters in order', () => {
    const word = game.wordConnect.currentWord;
    for (let i = 0; i < word.length; i += 1) {
      if (i > 0) restHand(game);
      face(game, SLOT_DIRECTIONS[nextSlot(game)]);
    }

    expect(game.wordConnect.status).toBe('COMPLETE');
    expect(game.wordConnect.wordsCompleted).toBe(1);
  });

  it('spends one letter per reach, however long the direction is held', () => {
    face(game, SLOT_DIRECTIONS[nextSlot(game)]);
    expect(game.wordConnect.snapshot().progress).toBe(1);

    // Still holding. The word must not run itself.
    advance(game, 1.5);
    expect(game.wordConnect.snapshot().progress).toBe(1);
    expect(game.wordConnect.status).toBe('PLAYING');
  });

  it('does nothing at all on a punch with the hand at rest', () => {
    punch(game);

    expect(game.wordConnect.status).toBe('PLAYING');
    expect(game.wordConnect.snapshot().progress).toBe(0);
  });

  it('fails the word the moment the hand reaches at the wrong letter', () => {
    const wrong = SLOT_DIRECTIONS[(nextSlot(game) + 2) % 4];
    face(game, wrong);

    expect(game.wordConnect.status).toBe('FAILED');
  });

  it('ignores a reach back over a letter already connected', () => {
    const first = SLOT_DIRECTIONS[nextSlot(game)];
    face(game, first);
    expect(game.wordConnect.snapshot().progress).toBe(1);

    restHand(game);
    face(game, first);

    expect(game.wordConnect.status).toBe('PLAYING');
    expect(game.wordConnect.snapshot().progress).toBe(1);
  });

  it('announces the next word, so the letters on screen change with it', () => {
    // The letter tiles are rendered from this event. A word that begins
    // without one leaves the last word's letters standing in the scene.
    const announced: Array<{ type: string; word: string }> = [];
    game.bus.on('wordConnect', (payload) =>
      announced.push({ type: payload.type, word: payload.word }),
    );

    face(game, SLOT_DIRECTIONS[(nextSlot(game) + 2) % 4]);
    expect(game.wordConnect.status).toBe('FAILED');

    advance(game, WORD_CONNECT_GAP + 0.2);
    expect(game.wordConnect.status).toBe('PLAYING');

    const latest = announced[announced.length - 1];
    expect(latest.type).toBe('START');
    expect(latest.word).toBe(game.wordConnect.currentWord);
  });

  it('announces the next word after one is connected, too', () => {
    const announced: Array<{ type: string; word: string }> = [];
    game.bus.on('wordConnect', (payload) =>
      announced.push({ type: payload.type, word: payload.word }),
    );

    const word = game.wordConnect.currentWord;
    for (let i = 0; i < word.length; i += 1) {
      if (i > 0) restHand(game);
      face(game, SLOT_DIRECTIONS[nextSlot(game)]);
    }
    expect(game.wordConnect.status).toBe('COMPLETE');

    advance(game, WORD_CONNECT_GAP + 0.2);
    const latest = announced[announced.length - 1];
    expect(latest.type).toBe('START');
    expect(latest.word).toBe(game.wordConnect.currentWord);
  });

  it('does not spend the next word on a direction held through the last one', () => {
    // Fail the current word while holding a direction, and keep holding it.
    const wrong = SLOT_DIRECTIONS[(nextSlot(game) + 2) % 4];
    face(game, wrong);
    expect(game.wordConnect.status).toBe('FAILED');

    advance(game, WORD_CONNECT_GAP + 0.2);
    expect(game.wordConnect.status).toBe('PLAYING');
    expect(game.wordConnect.snapshot().progress).toBe(0);
  });

  it('accepts a device that reports the punch direction itself', () => {
    // An IMU glove throwing a straight jab: no separate reach signal at all,
    // just the punch and where it travelled.
    const [x, y] = AXIS[SLOT_DIRECTIONS[nextSlot(game)]];
    game.input.punch({ laneIndex: null, direction: { x, y, z: -1 }, source: 'device' });

    expect(game.wordConnect.snapshot().progress).toBe(1);
  });

  it('hands the feet back once the special attack has fired', () => {
    // Let every word time out — the mini game ends either way.
    advance(game, (WORD_CONNECT_SECONDS + WORD_CONNECT_GAP) * WORD_CONNECT_WORDS + 0.5);
    expect(game.getSnapshot().combat.phase).not.toBe('WORD_CONNECT');

    game.input.motion.setAbsolute(-1);
    advance(game, 0.6);
    expect(game.input.stance).toBe(0);
  });
});

describe('the special attack lands as a sequence', () => {
  let game: GameManager;
  /** Every blow the monster took, in order. */
  let blows: number[];
  let announced: { damage: number; wordsCompleted: number } | null;

  beforeEach(() => {
    game = new GameManager();
    blows = [];
    announced = null;
    game.bus.on('monsterDamage', (payload) => {
      if (payload.special) blows.push(payload.amount);
    });
    game.bus.on('special', (payload) => {
      announced = payload;
    });

    enterWordConnect(game);
    // Connect every word, so the attack is at full strength.
    let guard = 0;
    while (game.wordConnect.active && guard < 40) {
      guard += 1;
      const needed = game.wordConnect.currentWord[game.wordConnect.snapshot().progress];
      const slot = game.wordConnect.liveSlots.find(
        (entry) => entry.letter === needed && entry.usedAt === null,
      );
      if (!slot) {
        advance(game, 0.3);
        continue;
      }
      restHand(game);
      face(game, SLOT_DIRECTIONS[slot.index]);
    }
    expect(game.getSnapshot().combat.phase).toBe('SPECIAL_ATTACK');
  });

  it('holds the blow back through the wind-up', () => {
    const hp = game.monster.hp;

    // The charge builds, but nothing has been hit yet — this is the beat that
    // makes the release land.
    advance(game, SPECIAL_WINDUP_SECONDS * 0.6);
    expect(blows).toHaveLength(0);
    expect(game.monster.hp).toBe(hp);
    expect(game.specialCharge).toBeGreaterThan(0.3);

    advance(game, SPECIAL_WINDUP_SECONDS);
    expect(blows.length).toBeGreaterThan(0);
    expect(game.monster.hp).toBeLessThan(hp);
  });

  it('hammers the monster rather than hitting it once', () => {
    advance(game, SPECIAL_SEQUENCE);

    // The mini game has already cleared itself, so the announcement is the
    // record of how many words were connected.
    const words = announced?.wordsCompleted ?? 0;
    expect(words).toBeGreaterThan(0);
    expect(blows.length).toBe(1 + words * SPECIAL_HITS_PER_WORD);
  });

  it('saves the heaviest blow for last', () => {
    advance(game, SPECIAL_SEQUENCE);

    const finisher = blows[blows.length - 1];
    for (const blow of blows.slice(0, -1)) expect(blow).toBeLessThan(finisher);
  });

  it('deals exactly the damage it announced', () => {
    const hp = game.monster.hp;
    advance(game, SPECIAL_SEQUENCE);

    const total = blows.reduce((sum, blow) => sum + blow, 0);
    expect(announced).not.toBeNull();
    expect(total).toBe(announced?.damage);
    expect(hp - game.monster.hp).toBe(total);
  });

  it('crawls time as the finisher lands, then lets it go again', () => {
    // Run up to the last blow.
    advance(game, SPECIAL_WINDUP_SECONDS + 1.2);
    expect(blows.length).toBeGreaterThan(1);

    const crawled = game.time;
    advance(game, 0.2);
    // A fifth of a second of real time buys much less than that in the world.
    expect(game.time - crawled).toBeLessThan(0.15);

    advance(game, SPECIAL_SEQUENCE);
    const settled = game.time;
    advance(game, 0.2);
    expect(game.time - settled).toBeCloseTo(0.2, 2);
  });

  it('leaves the blast and charge spent once it is over', () => {
    advance(game, SPECIAL_SEQUENCE);

    expect(game.getSnapshot().combat.phase).not.toBe('SPECIAL_ATTACK');
    expect(game.specialCharge).toBe(0);
    expect(game.specialBlast).toBe(0);
  });
});

describe('the kart chase', () => {
  /** Hurts the monster straight to a fraction of its health. */
  function woundTo(game: GameManager, fraction: number): void {
    const target = Math.round(game.monster.maxHp * fraction);
    game.monster.applyDamage(game.monster.hp - target, 0);
  }

  /** The row of pictures closest to the player that has not resolved yet. */
  function nearestWave(game: GameManager): KartBlockRuntime[] {
    const incoming = game.kart.liveBlocks.filter((block) => block.state === 'INCOMING');
    if (incoming.length === 0) return [];
    const id = Math.min(...incoming.map((block) => block.waveId));
    return incoming.filter((block) => block.waveId === id);
  }

  /**
   * Plays a chase out with the steering alone — never a punch, which is the
   * whole point of this mini game.
   */
  function drive(game: GameManager, pick: 'match' | 'decoy'): void {
    for (let frame = 0; frame < 3000 && game.kart.active; frame += 1) {
      const wanted = nearestWave(game).find(
        (block) => block.onTopic === (pick === 'match'),
      );
      if (wanted) game.input.motion.setAbsolute([-1, 0, 1][wanted.lane]);
      game.tick(FRAME);
    }
  }

  /** Wounds the monster, then lands one answer so the battle beat runs. */
  function provokeChase(game: GameManager, fraction = 0.5): void {
    startRound(game);
    woundTo(game, fraction);
    answerCorrectly(game);
  }

  it('never starts on level 1, however hurt the monster gets', () => {
    const game = new GameManager();
    startRound(game);
    expect(game.getSnapshot().combat.level).toBe(1);

    // Well past both flee thresholds — the diagnostic round still just asks
    // questions, because measuring English is the only thing it is for.
    woundTo(game, 0.05);
    answerCorrectly(game);

    expect(game.getSnapshot().combat.phase).not.toBe('KART_CHASE');
    expect(game.kart.active).toBe(false);

    advance(game, 6);
    expect(game.getSnapshot().combat.phase).not.toBe('KART_CHASE');
  });

  it('starts once a wounded monster is hit on level 2', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    const snapshot = game.getSnapshot();
    expect(snapshot.combat.level).toBeGreaterThan(1);
    expect(snapshot.combat.phase).toBe('KART_CHASE');
    expect(snapshot.kartChase.active).toBe(true);
    expect(snapshot.kartChase.topic.length).toBeGreaterThan(0);
    expect(snapshot.kartChase.gap).toBe(1);
    // The answer blocks are gone: the road is the only thing on screen.
    expect(game.targets).toHaveLength(0);
  });

  it('closes the gap on steering alone, and rams the monster for it', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    const hp = game.monster.hp;
    drive(game, 'match');

    expect(game.getSnapshot().combat.phase).not.toBe('KART_CHASE');
    expect(game.monster.hp).toBeLessThan(hp);
  });

  it('lets the monster get away when every picture is the wrong one', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    const hp = game.monster.hp;
    drive(game, 'decoy');

    // Crashing through the whole chase banks nothing, so it costs the monster
    // nothing — but it costs the player no health either. The chase is a
    // chance taken, never a punishment.
    expect(game.monster.hp).toBe(hp);
    expect(game.getSnapshot().combat.playerHp).toBe(game.getSnapshot().combat.playerMaxHp);
  });

  it('keeps the chase out of the accuracy numbers', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    const before = game.getSnapshot().stats;
    drive(game, 'match');
    const after = game.getSnapshot().stats;

    // Pictures are not questions, so they move the score and nothing else.
    expect(after.correct).toBe(before.correct);
    expect(after.wrong).toBe(before.wrong);
    expect(after.missed).toBe(before.missed);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('ignores a punch thrown at a picture', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    const banked = game.kart.collected;
    punch(game);
    punch(game);

    expect(game.getSnapshot().combat.phase).toBe('KART_CHASE');
    expect(game.kart.collected).toBe(banked);
  });

  it('clears the road once the chase is over', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    const types: string[] = [];
    game.bus.on('kartChase', (payload) => types.push(payload.type));

    // Catching it ends the chase early, with rows still in the air — the case
    // that used to leave frozen cards hanging in the tunnel, because a block
    // still INCOMING has no fade of its own to run.
    drive(game, 'match');

    expect(game.kart.active).toBe(false);
    expect(game.kart.liveBlocks).toHaveLength(0);
    // The scene mirrors the block list on this event, so the one announcing an
    // empty road has to be the last one out.
    expect(types[types.length - 1]).toBe('END');
  });

  it('leaves no picture behind once the next question is up', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);
    drive(game, 'match');
    advance(game, RESOLVE_DELAY + 2);

    expect(game.getSnapshot().combat.phase).toBe('ANSWERING');
    expect(game.kart.liveBlocks).toHaveLength(0);
    expect(game.getSnapshot().kartChase.active).toBe(false);
  });

  it('hands the road back and asks the next question', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);
    drive(game, 'match');

    advance(game, RESOLVE_DELAY + 1);
    expect(game.getSnapshot().combat.phase).toBe('ANSWERING');
    expect(game.targets).toHaveLength(3);
  });

  it('spends each flee threshold once, so the fight is not all driving', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);
    drive(game, 'decoy');
    advance(game, RESOLVE_DELAY + 1);

    // Same health band, another correct answer: it has already run from here.
    expect(game.getSnapshot().combat.phase).toBe('ANSWERING');
    answerCorrectly(game);
    expect(game.getSnapshot().combat.phase).not.toBe('KART_CHASE');
  });

  it('runs again once the monster is hurt into the next band', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game, KART_CHASE_HP_TRIGGERS[0]);
    drive(game, 'decoy');
    advance(game, RESOLVE_DELAY + 1);

    woundTo(game, KART_CHASE_HP_TRIGGERS[1]);
    answerCorrectly(game);

    expect(game.getSnapshot().combat.phase).toBe('KART_CHASE');
  });

  it('is steered with the feet, so the answer lanes still work after it', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);
    // The chase never takes the hand, so the motion model stays on the body.
    expect(game.input.motion.mode).toBe('STANCE');

    drive(game, 'match');
    advance(game, RESOLVE_DELAY + 1);

    moveTo(game, 0);
    expect(game.input.stance).toBe(0);
  });

  it('resolves a row against the nearest lane, gaps included', () => {
    const game = new GameManager();
    promoteToLevelTwo(game);
    provokeChase(game);

    // Out past RIGHT's standing tolerance is no answer at all while a question
    // is up — but a kart is always on some part of the road.
    game.input.motion.setAbsolute(0.55);
    advance(game, 0.5);
    expect(game.input.stance).toBeNull();
    expect(game.input.lane).toBe(2);
  });
});

describe('end-of-round review of wrong answers', () => {
  /** Answers with a real, landed, wrong choice. */
  function answerWrongly(game: GameManager): void {
    moveTo(game, wrongLane(game));
    punch(game);
  }

  let game: GameManager;

  beforeEach(() => {
    game = new GameManager();
    startRound(game);
  });

  it('records the right answer and a reason for a wrong choice', () => {
    const asked = game.getSnapshot().question;
    if (!asked) throw new Error('No question is live.');
    const expected = asked.answers[asked.correctAnswer];
    const picked = asked.answers[wrongLane(game)];

    answerWrongly(game);

    const review = game.getSnapshot().review;
    expect(review).toHaveLength(1);
    expect(review[0].question).toBe(asked.question);
    expect(review[0].yourAnswer).toBe(picked);
    expect(review[0].correctAnswer).toBe(expected);
    expect(review[0].explanation.length).toBeGreaterThan(0);
  });

  it('leaves correct answers out of the review', () => {
    answerCorrectly(game);
    expect(game.getSnapshot().review).toHaveLength(0);
  });

  it('records a question that ran out of time with no answer of your own', () => {
    game.input.motion.setAbsolute(-0.5);
    advance(game, 0.5);
    punch(game);

    const review = game.getSnapshot().review;
    expect(review).toHaveLength(1);
    expect(review[0].yourAnswer).toBeNull();
    expect(review[0].correctAnswer.length).toBeGreaterThan(0);
  });

  it('starts the next round with an empty review', () => {
    answerWrongly(game);
    expect(game.getSnapshot().review).toHaveLength(1);

    game.restart();
    expect(game.getSnapshot().review).toHaveLength(0);
  });

  it('explains every question in the built-in bank', () => {
    for (const question of QUESTIONS) {
      expect(question.explanation, `question ${question.id}`).toBeTruthy();
    }
  });
});
