import { AudioManager } from './AudioManager';
import { PunchKTLearner } from '../adaptive/PunchKTLearner';
import { requestAdaptivePlan } from '../adaptive/coachClient';
import { knowledgeComponentFor, misconceptionFor } from '../adaptive/questionProfile';
import { selectNextLevelStartDifficulty } from '../adaptive/startDifficulty';
import { ComboManager } from './ComboManager';
import { DifficultyManager } from './DifficultyManager';
import { KartChaseManager, chaseDamage, type KartGateResult } from './KartChaseManager';
import { MonsterManager } from './MonsterManager';
import { QuestionManager } from './QuestionManager';
import { ScoreManager } from './ScoreManager';
import { WordConnectManager, specialAttackDamage } from './WordConnectManager';
import { pickTopic } from './pictureBank';
import { pickWordConnectWords } from './wordBank';
import { EventBus, type GameEvents, type MissReason } from './events';
import { InputManager, KeyboardSource, slotOf } from './input';
import type { PunchEvent } from './input';
import {
  ANSWER_CHOICES,
  APPROACH_TIME,
  COLORS,
  COUNTDOWN_SECONDS,
  DESPAWN_Z,
  DIAGNOSTIC_LEVEL,
  ENTRY_TIME,
  GAME_OVER_SECONDS,
  HIT_WINDOW,
  KART_BLOCK_Y,
  KART_CHASE_HP_TRIGGERS,
  KART_GAP_DAMPING,
  KART_LANE_X,
  KART_RUSH_ATTACK,
  KART_RUSH_RELEASE,
  KART_SCORE_PER_PICTURE,
  KART_WAVES,
  LANE_X,
  LANE_Y,
  MONSTER_RECOVER_SECONDS,
  MONSTER_STRIKE_SECONDS,
  MONSTER_Y,
  MONSTER_Z,
  PLAYER_HAND,
  PLAYER_HIT_DAMAGE,
  PLAYER_MAX_HP,
  READ_TIME,
  READ_Z,
  RESOLVE_DELAY,
  SESSION_QUESTIONS,
  SESSION_SECONDS,
  SLOT_X,
  SLOT_Y,
  SLOT_Z,
  SPAWN_Z,
  SPECIAL_FINISHER_SHARE,
  SPECIAL_FINISH_SECONDS,
  SPECIAL_HITS_PER_WORD,
  SPECIAL_HIT_INTERVAL,
  SPECIAL_SCORE_PER_DAMAGE,
  SPECIAL_SLOWMO_SCALE,
  SPECIAL_SLOWMO_SECONDS,
  SPECIAL_WINDUP_SECONDS,
  STRIKE_Z,
  WORD_CONNECT_STREAK,
  WORD_CONNECT_WORDS,
} from './constants';
import type {
  AnswerRecord,
  CombatPhase,
  CombatSnapshot,
  Difficulty,
  GameSettings,
  GameState,
  HitQuality,
  KartChaseSnapshot,
  Outcome,
  Question,
  ReviewItem,
  RoundOutcome,
  SessionStats,
  TargetRuntime,
  WordConnectSnapshot,
} from './types';
import type { CoachState } from '../adaptive/contracts';

/** Snapshot handed to React whenever something worth repainting changes. */
export interface GameSnapshot {
  state: GameState;
  question: Question | null;
  questionNumber: number;
  totalQuestions: number;
  timeRemaining: number;
  countdown: number;
  stats: SessionStats;
  lastOutcome: {
    outcome: Outcome;
    quality: HitQuality | null;
    points: number;
    combo: number;
    /** Bumped on every resolution so the HUD can re-key its animations. */
    seq: number;
  } | null;
  coach: CoachState;
  combat: CombatSnapshot;
  wordConnect: WordConnectSnapshot;
  kartChase: KartChaseSnapshot;
  /** Wrong and missed questions from this round, for the end-of-round review. */
  review: ReviewItem[];
}

/**
 * How often the HUD is refreshed while a combat timer is running.
 *
 * Normal play publishes on discrete events only. A wind-up counting down to a
 * defence window needs a moving number, but twelve renders a second is still
 * nowhere near the per-frame path the architecture keeps React out of.
 */
const COMBAT_PUBLISH_INTERVAL = 1 / 12;

const DEFAULT_SETTINGS: GameSettings = {
  musicVolume: 0.45,
  sfxVolume: 0.8,
  speed: 1,
  adaptiveDifficulty: true,
  screenShake: true,
};

const PRAISE = ['PERFECT!', 'NICE!', 'GREAT!', 'CRUSHED IT!', 'BOOM!'];

/** The beats of a special attack: hold, hammer, then one blow that ends it. */
type SpecialStage = 'WINDUP' | 'BARRAGE' | 'FINISH';

/** Where the finisher throws its extra debris, relative to the monster. */
const FINISHER_BURSTS: ReadonlyArray<readonly [number, number]> = [
  [-4.6, 1.8],
  [4.6, 0.4],
  [0, -3.2],
];

/**
 * The authoritative game simulation.
 *
 * Owns state, runs a per-frame `tick`, and announces changes on an event bus.
 * It knows nothing about React or Three.js — the scene reads the mutable
 * `targets` array directly inside its render loop, and the HUD listens for
 * discrete snapshots. Nothing here re-renders anything sixty times a second.
 */
export class GameManager {
  readonly bus = new EventBus();
  readonly input = new InputManager();
  readonly audio = new AudioManager();
  readonly score = new ScoreManager();
  readonly combo = new ComboManager();
  readonly questions = new QuestionManager();
  readonly difficulty = new DifficultyManager();
  readonly learner = new PunchKTLearner();
  readonly monster = new MonsterManager();
  readonly wordConnect = new WordConnectManager();
  readonly kart = new KartChaseManager();

  /** Live targets. Mutated in place every frame; never reallocated per frame. */
  readonly targets: TargetRuntime[] = [];

  settings: GameSettings = { ...DEFAULT_SETTINGS };

  /** Camera shake energy, 0..1, decayed each frame by the scene. */
  shake = 0;
  /** Rises to 1 on every musical beat and falls back — drives scene pulsing. */
  beatPulse = 0;
  /**
   * 0..1 while the special attack winds up: the held breath before it lands.
   * The scene reads it to pull the world in toward the monster.
   */
  specialCharge = 0;
  /** 0..1, spiked by every blow of the special attack. Drives flash and zoom. */
  specialBlast = 0;

  /**
   * How hard the world is rushing past, 0..1.
   *
   * The chase's presentation all hangs off this one number: the tunnel grid
   * scrolls by it, the camera drops and widens by it, the speed streaks fade in
   * on it. It ramps rather than snapping, so the world winds up into the chase
   * and coasts back out instead of cutting between two states.
   */
  chaseRush = 0;
  /**
   * Smoothed distance to the fleeing monster, 1 far → 0 alongside. Damped
   * rather than read straight off `kart.gap` so every picture banked hauls the
   * monster visibly closer instead of teleporting it.
   */
  chaseGap = 1;
  /** Spikes to 1 when a picture is banked. A lurch forward. */
  chaseLurch = 0;
  /** Spikes to 1 on a crash. A jolt sideways. */
  chaseSlam = 0;

  private state: GameState = 'MENU';
  private currentQuestion: Question | null = null;
  private questionNumber = 0;
  private questionShownAt = 0;
  private resolved = true;
  private nextSpawnAt = 0;
  private timeRemaining = SESSION_SECONDS;
  private countdownRemaining = COUNTDOWN_SECONDS;
  private lastCountdownValue = -1;
  private gameOverRemaining = 0;
  private elapsed = 0;
  private nextTargetId = 1;
  private outcomeSeq = 0;
  private lastOutcome: GameSnapshot['lastOutcome'] = null;
  private lastPublishedSecond = -1;
  private praiseIndex = 0;
  private sessionFinalized = false;
  private coachRequestId = 0;
  private pendingQuestionPool: Question[] | null = null;
  private nextStartDifficulty: Difficulty = 'easy';
  /** Wrong and missed questions from the current round, newest last. */
  private review: ReviewItem[] = [];
  private coach: CoachState = { status: 'idle', package: null, message: null };

  // ---------------------------------------------------------------- battle --

  private phase: CombatPhase = 'ANSWERING';
  /** 1 is the diagnostic round. From 2 up, the monster hits back. */
  private level = 1;
  private playerHp = PLAYER_MAX_HP;
  private correctStreak = 0;
  private strikeRemaining = 0;
  private specialRemaining = 0;
  private roundOutcome: RoundOutcome | null = null;
  /** Answer text from the round so far, mined for word-connect puzzles. */
  private recentAnswers: string[] = [];
  /**
   * The letter slot the hand was already in. Reaching *into* a slot is what
   * connects a letter, so only a change counts — holding a direction connects
   * one letter, not a stream of them.
   */
  private lastReachSlot: number | null = null;
  /**
   * How many of `KART_CHASE_HP_TRIGGERS` the monster has already bolted at.
   * Each threshold is worth exactly one chase per fight.
   */
  private chasesSpent = 0;
  /** The last chase's topic, so two in a row are never the same vocabulary. */
  private lastChaseTopic: string | null = null;
  /** Which beat of the special attack is running. */
  private specialStage: SpecialStage = 'FINISH';
  private specialHitsLeft = 0;
  private specialHitTimer = 0;
  /** Damage still to be spread across the barrage, and the blow that ends it. */
  private specialPool = 0;
  private specialFinisher = 0;
  /** Real seconds of slow motion left. */
  private slowMoRemaining = 0;
  private publishAccumulator = 0;

  private publish: (snapshot: GameSnapshot) => void = () => {};
  private unsubscribePunch: (() => void) | null = null;
  private unsubscribeGuard: (() => void) | null = null;

  constructor() {
    this.unsubscribePunch = this.input.onPunch(this.handlePunch);
    this.unsubscribeGuard = this.input.onGuard(this.handleGuard);
    this.input.addSource(new KeyboardSource());
    this.level = this.learner.level;
    this.audio.onBeat = () => {
      this.beatPulse = 1;
      this.bus.emit('beat', { index: 0 });
    };
  }

  // ------------------------------------------------------------ lifecycle --

  setPublisher(publish: (snapshot: GameSnapshot) => void): void {
    this.publish = publish;
    this.emitSnapshot();
  }

  getState(): GameState {
    return this.state;
  }

  applySettings(partial: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.audio.setMusicVolume(this.settings.musicVolume);
    this.audio.setSfxVolume(this.settings.sfxVolume);
    this.emitSnapshot();
  }

  /** Any UI interaction routes through here so audio unlocks on a gesture. */
  uiSound(): void {
    this.audio.unlock();
    this.audio.play('ui');
  }

  goToMenu(): void {
    this.setState('MENU');
    this.audio.stopMusic();
    this.clearTargets();
  }

  showHowToPlay(): void {
    this.setState('HOW_TO_PLAY');
  }

  showSettings(): void {
    this.setState('SETTINGS');
  }

  startCountdown(): void {
    this.audio.unlock();
    this.resetSession();
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.lastCountdownValue = -1;
    this.setState('COUNTDOWN');
    this.audio.setMusicDucked(false);
    this.audio.startMusic();
  }

  pause(): void {
    if (this.state !== 'PLAYING') return;
    this.setState('PAUSED');
    this.input.setEnabled(false);
    this.audio.setMusicDucked(true);
  }

  resume(): void {
    if (this.state !== 'PAUSED') return;
    this.setState('PLAYING');
    this.input.setEnabled(true);
    this.audio.setMusicDucked(false);
  }

  togglePause(): void {
    if (this.state === 'PLAYING') this.pause();
    else if (this.state === 'PAUSED') this.resume();
  }

  quitToMenu(): void {
    this.input.setEnabled(true);
    this.goToMenu();
  }

  restart(): void {
    this.startCountdown();
  }

  private resetSession(): void {
    if (this.pendingQuestionPool) {
      this.questions.setPool(this.pendingQuestionPool);
      this.pendingQuestionPool = null;
    }
    this.score.reset();
    this.combo.reset();
    this.questions.reset();
    this.difficulty.reset(this.nextStartDifficulty);
    this.clearTargets();
    this.currentQuestion = null;
    this.questionNumber = 0;
    this.resolved = true;
    this.timeRemaining = SESSION_SECONDS;
    this.elapsed = 0;
    this.nextSpawnAt = 0;
    this.lastOutcome = null;
    this.lastPublishedSecond = -1;
    this.shake = 0;
    this.sessionFinalized = false;
    this.coach = { status: 'idle', package: null, message: null };
    this.review = [];

    // A fresh fight: full health on both sides, and the level the learner
    // profile says we are on, which is what gates the monster's counter-attack.
    this.level = this.learner.level;
    this.phase = 'ANSWERING';
    this.playerHp = PLAYER_MAX_HP;
    this.correctStreak = 0;
    this.strikeRemaining = 0;
    this.specialRemaining = 0;
    this.roundOutcome = null;
    this.recentAnswers = [];
    this.lastReachSlot = null;
    this.chasesSpent = 0;
    this.lastChaseTopic = null;
    this.chaseRush = 0;
    this.chaseGap = 1;
    this.chaseLurch = 0;
    this.chaseSlam = 0;
    this.publishAccumulator = 0;
    this.monster.reset();
    this.wordConnect.reset();
    this.kart.reset();

    this.input.setEnabled(true);
    this.input.setAimLane(null);
    this.input.motion.reset();
  }

  private setState(state: GameState): void {
    if (this.state === state) return;
    this.state = state;
    this.bus.emit('state', { state });
    this.emitSnapshot();
  }

  // ----------------------------------------------------------------- loop --

  /** Driven by a single `useFrame` inside the R3F canvas. */
  tick(rawDelta: number): void {
    // Clamp so an alt-tab pause cannot teleport every target past the player.
    const real = Math.min(rawDelta, 0.05);

    // Time crawls as a finisher lands. Scaling here rather than inside the
    // special attack keeps the whole world — clock, monster, particles — in
    // step, which is the only way slow motion reads as weight instead of lag.
    if (this.slowMoRemaining > 0) this.slowMoRemaining -= real;
    const dt = this.slowMoRemaining > 0 ? real * SPECIAL_SLOWMO_SCALE : real;

    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.2);
    this.specialBlast = Math.max(0, this.specialBlast - dt * 2.6);
    if (this.phase !== 'SPECIAL_ATTACK') {
      this.specialCharge = Math.max(0, this.specialCharge - dt * 3);
    }
    this.tickChaseFeel(real);

    switch (this.state) {
      case 'COUNTDOWN':
        this.tickCountdown(dt);
        break;
      case 'PLAYING':
        this.tickPlaying(dt);
        break;
      case 'GAME_OVER':
        this.gameOverRemaining -= dt;
        if (this.gameOverRemaining <= 0) this.setState('RESULTS');
        break;
      default:
        break;
    }
  }

  /**
   * Advance the chase's presentation signals.
   *
   * Driven by *real* seconds, not the slow-motion clock: the rush is how fast
   * the world feels, and a finisher crawling time should not also decide how
   * quickly the tunnel spins up.
   */
  private tickChaseFeel(dt: number): void {
    const chasing = this.phase === 'KART_CHASE';
    this.chaseRush = damp(
      this.chaseRush,
      chasing ? 1 : 0,
      chasing ? KART_RUSH_ATTACK : KART_RUSH_RELEASE,
      dt,
    );
    // Once the chase is over the gap opens back up slowly, which is what walks
    // the monster back to its resting place instead of snapping it there.
    this.chaseGap = damp(
      this.chaseGap,
      chasing ? this.kart.gap : 1,
      chasing ? KART_GAP_DAMPING : 1.2,
      dt,
    );
    this.chaseLurch = Math.max(0, this.chaseLurch - dt * 2.2);
    this.chaseSlam = Math.max(0, this.chaseSlam - dt * 2.6);
  }

  private tickCountdown(dt: number): void {
    this.countdownRemaining -= dt;
    // COUNTDOWN_SECONDS is 4 so the sequence reads 3 · 2 · 1 · GO!
    const value = Math.max(0, Math.ceil(this.countdownRemaining) - 1);
    if (value !== this.lastCountdownValue) {
      this.lastCountdownValue = value;
      this.bus.emit('countdown', { value });
      this.audio.play(value === 0 ? 'go' : 'countdown');
      this.emitSnapshot();
    }
    if (this.countdownRemaining <= 0) {
      this.setState('PLAYING');
      this.nextSpawnAt = this.elapsed;
    }
  }

  private tickPlaying(dt: number): void {
    // Movement runs in every phase — the player walks between lanes while
    // answering, and around the letter slots during the mini game.
    this.input.update(dt, this.elapsed);

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endGame('TIME');
      return;
    }

    switch (this.phase) {
      case 'ANSWERING':
      case 'RESOLVING':
        this.tickAnswering(dt);
        break;
      case 'MONSTER_CHARGING':
        if (this.monster.tickCharge(dt, this.elapsed)) this.resolveMonsterStrike();
        break;
      case 'MONSTER_STRIKING':
        this.tickMonsterStrike(dt);
        break;
      case 'WORD_CONNECT':
        this.tickWordConnect(dt);
        break;
      case 'SPECIAL_ATTACK':
        this.tickSpecialAttack(dt);
        break;
      case 'KART_CHASE':
        this.tickKartChase(dt);
        break;
    }

    this.publishClock(dt);
  }

  private tickAnswering(dt: number): void {
    // Three-phase motion: blocks rush in from the tunnel, hold at the read
    // plane while the player takes them in, then close on the strike plane.
    for (const target of this.targets) {
      if (target.state !== 'INCOMING' && target.state !== 'REVEAL') continue;

      if (this.elapsed < target.entryUntil) {
        const k = 1 - (target.entryUntil - this.elapsed) / ENTRY_TIME;
        target.z = SPAWN_Z + (READ_Z - SPAWN_Z) * easeOutCubic(clamp01(k));
      } else if (this.elapsed < target.holdUntil) {
        target.z = READ_Z;
      } else {
        target.z += target.speed * dt;
      }
    }

    // The question is missed once the row has flown past untouched.
    if (!this.resolved && this.targets.some((t) => t.z > DESPAWN_Z)) {
      this.resolveMiss('ESCAPED');
      return;
    }

    if (this.resolved && this.elapsed >= this.nextSpawnAt) {
      if (this.score.answered >= SESSION_QUESTIONS) this.endGame('QUESTIONS');
      else this.spawnQuestion();
    }
  }

  /**
   * Publishes on the whole second for the round clock, and faster while a
   * combat timer is on screen and needs to actually move.
   */
  private publishClock(dt: number): void {
    const timed =
      this.phase === 'MONSTER_CHARGING' ||
      this.phase === 'MONSTER_STRIKING' ||
      this.phase === 'WORD_CONNECT' ||
      this.phase === 'KART_CHASE';

    if (timed) {
      this.publishAccumulator += dt;
      if (this.publishAccumulator >= COMBAT_PUBLISH_INTERVAL) {
        this.publishAccumulator = 0;
        this.lastPublishedSecond = Math.ceil(this.timeRemaining);
        this.emitSnapshot();
        return;
      }
    }

    const second = Math.ceil(this.timeRemaining);
    if (second !== this.lastPublishedSecond) {
      this.lastPublishedSecond = second;
      this.emitSnapshot();
    }
  }

  private endGame(outcome: RoundOutcome): void {
    if (this.sessionFinalized) return;
    this.sessionFinalized = true;
    this.roundOutcome = outcome;
    this.wordConnect.reset();
    this.kart.reset();
    // The round can end mid mini game, so the hand never stays in control.
    this.input.motion.setMode('STANCE');
    this.clearTargets();
    this.audio.stopMusic();
    this.audio.play('gameover');
    this.bus.emit('round', { outcome });
    this.gameOverRemaining = GAME_OVER_SECONDS;
    const report = this.learner.buildReport(this.score.history, this.getStats());
    this.nextStartDifficulty = selectNextLevelStartDifficulty(this.difficulty.difficulty, report);
    this.learner.completeSession();
    this.coach = { status: 'loading', package: null, message: null };
    this.setState('GAME_OVER');
    void this.prepareNextLevel(report);
  }

  private async prepareNextLevel(report: Parameters<typeof requestAdaptivePlan>[0]): Promise<void> {
    const requestId = ++this.coachRequestId;
    const result = await requestAdaptivePlan(report);
    if (requestId !== this.coachRequestId) return;

    if (this.state === 'PLAYING' || this.state === 'COUNTDOWN' || this.state === 'PAUSED') {
      this.pendingQuestionPool = result.package.questions;
    } else {
      this.questions.setPool(result.package.questions);
    }
    this.coach = {
      status: result.package.source === 'llm' ? 'ready' : 'fallback',
      package: result.package,
      message: result.message,
    };
    this.emitSnapshot();
  }

  // -------------------------------------------------------------- spawning --

  private spawnQuestion(): void {
    const question = this.questions.next(this.difficulty.difficulty);
    if (!question) {
      this.endGame('QUESTIONS');
      return;
    }

    this.clearTargets();
    this.currentQuestion = question;
    this.questionNumber += 1;
    this.resolved = false;
    this.questionShownAt = this.elapsed;
    this.phase = 'ANSWERING';
    this.monster.settle(this.elapsed);
    // Vocabulary from this round is the first place the word-connect puzzle
    // looks, so the special attack is built from words the player just read.
    this.recentAnswers.push(...question.answers);

    const approach = APPROACH_TIME[question.difficulty] / Math.max(0.4, this.settings.speed);
    const speed = (STRIKE_Z - READ_Z) / approach;
    const entryUntil = this.elapsed + ENTRY_TIME;
    const holdUntil = entryUntil + READ_TIME[question.difficulty];

    for (let lane = 0; lane < ANSWER_CHOICES; lane += 1) {
      this.targets.push({
        id: this.nextTargetId++,
        lane,
        label: question.answers[lane] ?? '',
        isCorrect: lane === question.correctAnswer,
        x: LANE_X[lane],
        y: LANE_Y[lane],
        z: SPAWN_Z,
        speed,
        entryUntil,
        holdUntil,
        state: 'INCOMING',
        stateTime: this.elapsed,
        spawnedAt: this.elapsed,
      });
    }

    this.bus.emit('question', {
      question,
      targets: this.targets,
      index: this.questionNumber,
    });
    this.emitSnapshot();
  }

  private clearTargets(): void {
    this.targets.length = 0;
    this.input.setAimLane(null);
  }

  // ---------------------------------------------------------------- input --

  /**
   * The one and only entry point for player action. Mouse, keyboard, and any
   * future motion controller all arrive here as an identical `PunchEvent`.
   *
   * Answering takes two steps: walk to the answer, then punch. This is where
   * the second step is checked against the first.
   */
  private handlePunch = (event: PunchEvent): void => {
    if (this.state !== 'PLAYING') return;

    if (this.phase === 'WORD_CONNECT') {
      this.punchWordConnect(event);
      return;
    }

    if (this.phase !== 'ANSWERING' || this.resolved) {
      this.whiff(null);
      return;
    }

    const lane = this.resolveLane(event.laneIndex, this.input.stance);
    this.bus.emit('punch', { hand: PLAYER_HAND, lane });

    // Punched from between lanes, or at a block the player is not standing in
    // front of. That is a MISS — deliberately not a guess at the nearest
    // answer, because the position *is* the answer.
    if (lane === null) {
      this.resolveMiss('POSITION');
      return;
    }

    const target = this.targets.find((t) => t.lane === lane && t.state === 'INCOMING') ?? null;
    if (!target) {
      this.resolveMiss('POSITION');
      return;
    }
    this.resolveHit(target, event);
  };

  /**
   * The lane a punch counts for.
   *
   * The player's position decides it. A source that also names a lane — a mouse
   * click on a specific block — only counts when it agrees with where the
   * player is standing, so clicking cannot skip the walk.
   */
  private resolveLane(aimed: number | null, position: number | null): number | null {
    if (position === null) return null;
    if (aimed !== null && aimed !== position) return null;
    return position;
  }

  private whiff(lane: number | null): void {
    this.audio.play('whiff');
    this.shake = Math.min(1, this.shake + 0.08);
    this.bus.emit('punch', { hand: PLAYER_HAND, lane });
    this.bus.emit('whiff', { lane });
  }

  /** A raised guard is worth a beat of feedback whenever the player asks for it. */
  private handleGuard = (raised: boolean): void => {
    if (!raised || this.state !== 'PLAYING') return;
    this.audio.play('ui');
    this.bus.emit('guard', { raised: true });
    this.emitSnapshot();
  };

  private resolveHit(target: TargetRuntime, event: PunchEvent): void {
    const quality = gradeHit(target.z);
    const reactionTime = this.elapsed - this.questionShownAt;
    const question = this.currentQuestion;
    if (!question) return;

    this.resolved = true;
    this.nextSpawnAt = this.elapsed + RESOLVE_DELAY;
    target.state = 'HIT';
    target.stateTime = this.elapsed;

    this.audio.play('punch');

    let points: number;
    let outcome: 'CORRECT' | 'WRONG';

    if (target.isCorrect) {
      outcome = 'CORRECT';
      this.combo.increment();
      points = this.score.award(quality, this.combo.multiplier);
      this.audio.play('correct');
      if (this.combo.isMilestone()) this.audio.play('combo', this.combo.multiplier * 2);
      this.shake = Math.min(1, 0.45 + event.power * 0.35);
      this.bus.emit('impact', {
        x: target.x,
        y: target.y,
        z: target.z,
        color: COLORS.correct,
        power: 1 + event.power,
      });
      // A right answer is a landed blow: the punch carries through the block
      // and into the monster behind it.
      this.strikeMonster(
        this.monster.damageFor(quality, this.combo.current),
        false,
        target.lane,
      );
      this.praiseIndex = (this.praiseIndex + 1) % PRAISE.length;
    } else {
      outcome = 'WRONG';
      this.combo.break();
      points = this.score.penalise();
      this.audio.play('wrong');
      this.shake = Math.min(1, 0.7 + event.power * 0.3);
      this.bus.emit('impact', {
        x: target.x,
        y: target.y,
        z: target.z,
        color: COLORS.wrong,
        power: 1.2,
      });
      // Show the player what they should have punched.
      const correct = this.targets.find((t) => t.isCorrect);
      if (correct) {
        correct.state = 'REVEAL';
        correct.stateTime = this.elapsed;
      }
    }

    for (const other of this.targets) {
      if (other.state === 'INCOMING') {
        other.state = 'FADE';
        other.stateTime = this.elapsed;
      }
    }

    this.finishQuestion(question, outcome, quality, points, reactionTime, target.lane);
  }

  /**
   * No answer landed: either the row flew past, or the player punched from
   * outside any answer's standing position.
   */
  private resolveMiss(reason: MissReason): void {
    const question = this.currentQuestion;
    if (!question || this.resolved) return;

    this.resolved = true;
    this.nextSpawnAt = this.elapsed + RESOLVE_DELAY * 0.6;
    this.combo.break();
    this.score.registerMiss();
    this.audio.play(reason === 'POSITION' ? 'whiff' : 'wrong');
    this.shake = Math.min(1, this.shake + 0.35);

    for (const target of this.targets) {
      target.state = 'ESCAPED';
      target.stateTime = this.elapsed;
    }

    this.finishQuestion(
      question,
      'MISS',
      null,
      0,
      this.elapsed - this.questionShownAt,
      null,
      reason,
    );
  }

  private finishQuestion(
    question: Question,
    outcome: Outcome,
    quality: HitQuality | null,
    points: number,
    reactionTime: number,
    lane: number | null,
    missReason: MissReason | null = null,
  ): void {
    const record: AnswerRecord = {
      questionId: question.id,
      difficulty: question.difficulty,
      category: question.category,
      outcome,
      reactionTime,
      quality,
      selectedAnswer: lane,
      correctAnswer: question.correctAnswer,
      selectedText: lane === null ? null : question.answers[lane] ?? null,
      correctText: question.answers[question.correctAnswer] ?? '',
      knowledgeComponent: knowledgeComponentFor(question),
      misconception: misconceptionFor(question, lane),
      recordedAt: Date.now(),
    };
    this.score.record(record);
    this.learner.record(record);

    // Anything that was not answered correctly is worth showing back to the
    // player at the end, with the right answer and a reason for it.
    if (outcome !== 'CORRECT') {
      this.review.push({
        questionId: question.id,
        question: question.question,
        yourAnswer: record.selectedText,
        correctAnswer: record.correctText,
        explanation: question.explanation?.trim()
          || `“${record.correctText}” is the right answer here.`,
      });
    }

    const direction = this.difficulty.evaluate(record, this.settings.adaptiveDifficulty);
    if (direction) {
      this.bus.emit('difficulty', {
        from: question.difficulty,
        to: this.difficulty.difficulty,
        direction,
      });
    }

    this.outcomeSeq += 1;
    this.lastOutcome = {
      outcome,
      quality,
      points,
      combo: this.combo.current,
      seq: this.outcomeSeq,
    };

    this.bus.emit('resolved', {
      outcome,
      quality,
      lane,
      correctLane: question.correctAnswer,
      points,
      combo: this.combo.current,
      multiplier: this.combo.multiplier,
      missReason,
    });

    this.advanceBattle(outcome);
    this.emitSnapshot();
  }

  // ---------------------------------------------------------------- battle --

  /**
   * The battle beat that follows every answer.
   *
   * A right answer damages the monster and builds toward a special attack;
   * anything else hands the initiative over — except on the diagnostic level,
   * where the point is to measure English, not to punish it.
   */
  private advanceBattle(outcome: Outcome): void {
    if (outcome === 'CORRECT') {
      this.correctStreak += 1;
      if (!this.monster.alive) {
        this.endGame('VICTORY');
        return;
      }
      if (this.correctStreak >= WORD_CONNECT_STREAK && this.startWordConnect()) return;
      if (this.maybeStartChase()) return;
    } else {
      this.correctStreak = 0;
      if (this.canCounterAttack()) {
        this.beginMonsterAttack();
        return;
      }
    }
    this.phase = 'RESOLVING';
  }

  /** Level 1 is diagnostic: a wrong answer there costs nothing but the streak. */
  private canCounterAttack(): boolean {
    return this.level > DIAGNOSTIC_LEVEL && this.monster.alive;
  }

  /** @param intensity scales the noise a single blow makes, 0..2. */
  private strikeMonster(
    amount: number,
    special: boolean,
    lane: number | null,
    intensity = 1,
  ): number {
    const dealt = this.monster.applyDamage(amount, this.elapsed);
    if (dealt <= 0) return 0;
    this.audio.play('monsterHit', intensity);
    this.bus.emit('monsterDamage', {
      amount: dealt,
      hp: this.monster.hp,
      maxHp: this.monster.maxHp,
      special,
      lane,
    });
    this.bus.emit('impact', {
      x: 0,
      y: MONSTER_Y,
      z: MONSTER_Z + 2.5,
      color: special ? COLORS.warm : COLORS.monster,
      power: (special ? 2.4 : 1.3) * intensity,
    });
    return dealt;
  }

  private beginMonsterAttack(): void {
    this.phase = 'MONSTER_CHARGING';
    this.monster.beginCharge(this.elapsed);
    this.audio.play('charge');
    this.bus.emit('monsterPhase', {
      phase: 'CHARGING',
      chargeSeconds: this.monster.chargeRemaining,
    });
  }

  /**
   * The blow lands. The only thing that matters is whether the guard is up at
   * this instant — which is why a guard raised too early has already dropped.
   */
  private resolveMonsterStrike(): void {
    const blocked = this.input.isGuarding();
    this.phase = 'MONSTER_STRIKING';
    this.strikeRemaining = MONSTER_STRIKE_SECONDS;
    this.bus.emit('monsterPhase', { phase: 'STRIKING', chargeSeconds: 0 });

    let damage = 0;
    if (blocked) {
      this.audio.play('block');
      this.shake = Math.min(1, this.shake + 0.3);
    } else {
      damage = Math.min(PLAYER_HIT_DAMAGE, this.playerHp);
      this.playerHp -= damage;
      this.audio.play('hurt');
      this.shake = 1;
    }

    this.bus.emit('defense', { blocked, damage, playerHp: this.playerHp });
    this.bus.emit('impact', {
      x: 0,
      y: 2.4,
      z: 1.4,
      color: blocked ? COLORS.accent : COLORS.wrong,
      power: blocked ? 1.1 : 1.9,
    });
    this.emitSnapshot();
  }

  private tickMonsterStrike(dt: number): void {
    this.strikeRemaining -= dt;
    if (this.strikeRemaining > 0) return;
    if (this.playerHp <= 0) {
      this.endGame('DEFEAT');
      return;
    }
    this.monster.settle(this.elapsed);
    this.resumeAnswering(MONSTER_RECOVER_SECONDS);
  }

  private resumeAnswering(delay: number): void {
    this.phase = 'RESOLVING';
    this.nextSpawnAt = this.elapsed + delay;
    this.emitSnapshot();
  }

  // ---------------------------------------------------------- word connect --

  /** @returns false when no valid puzzle could be built, so play just continues. */
  private startWordConnect(): boolean {
    const words = pickWordConnectWords(
      this.recentAnswers,
      this.questions.questions,
      WORD_CONNECT_WORDS,
    );
    if (words.length === 0) return false;

    this.clearTargets();
    this.wordConnect.start(words);
    this.phase = 'WORD_CONNECT';
    // Feet out of it: from here the player stands in the centre and aims with
    // the hand alone. This also drops the hand to rest, so the first letter
    // always costs a deliberate reach.
    this.input.motion.setMode('REACH');
    this.lastReachSlot = null;
    this.audio.play('combo', 8);
    this.bus.emit('wordConnect', {
      type: 'START',
      letter: null,
      word: this.wordConnect.currentWord,
      wordsCompleted: 0,
    });
    return true;
  }

  private tickWordConnect(dt: number): void {
    const before = this.wordConnect.status;
    const result = this.wordConnect.tick(dt);
    const status = this.wordConnect.status;

    if (status !== before) {
      if (status === 'FAILED') {
        this.audio.play('whiff');
        this.bus.emit('wordConnect', {
          type: 'FAIL',
          letter: null,
          word: this.wordConnect.currentWord,
          wordsCompleted: this.wordConnect.wordsCompleted,
        });
      }
      if (status === 'PLAYING') {
        // A fresh word: whatever the hand is already doing does not count for
        // it, so a direction held through the last word cannot spend a letter.
        this.lastReachSlot = this.input.slotIndex;
        // And it has to be announced. The letters in the scene are rendered
        // from this event, so a word that begins silently leaves the previous
        // word's tiles on screen until something else happens to publish.
        this.bus.emit('wordConnect', {
          type: 'START',
          letter: null,
          word: this.wordConnect.currentWord,
          wordsCompleted: this.wordConnect.wordsCompleted,
        });
        this.emitSnapshot();
      }
    }

    if (result === 'DONE') {
      this.fireSpecialAttack();
      return;
    }

    this.readReach();
  }

  /**
   * Reaching at a letter *is* choosing it — there is no second step here.
   *
   * Answering needs the punch because standing in a lane has to be separable
   * from committing to it. A letter slot has nothing else to mean: the hand
   * only goes there to take it, so the reach commits on its own.
   */
  private readReach(): void {
    const slot = this.input.slotIndex;
    if (slot === this.lastReachSlot) return;
    this.lastReachSlot = slot;
    if (slot === null || this.wordConnect.status !== 'PLAYING') return;
    this.connectLetter(slot);
  }

  /**
   * A punch is optional during the mini game: the reach has already chosen.
   * It still counts when it names a letter by itself — a pointer on a tile, or
   * a device that reports the direction the fist travelled.
   */
  private punchWordConnect(event: PunchEvent): void {
    const slot = event.laneIndex ?? slotOf(event.direction.x, event.direction.y);
    if (slot === null || slot === this.lastReachSlot) return;
    this.lastReachSlot = slot;
    this.connectLetter(slot);
  }

  private connectLetter(facing: number): void {
    const progressBefore = this.wordConnect.snapshot().progress;
    const result = this.wordConnect.punch(facing);
    if (result === 'IGNORED') return;

    // The fist still swings at the letter — it is feedback now, not input.
    this.bus.emit('punch', { hand: PLAYER_HAND, lane: null });

    const word = this.wordConnect.currentWord;
    if (result === 'HIT' || result === 'WORD') {
      const slot = facing ?? 0;
      this.audio.play(result === 'WORD' ? 'correct' : 'letter', progressBefore);
      this.shake = Math.min(1, this.shake + (result === 'WORD' ? 0.4 : 0.16));
      this.bus.emit('impact', {
        x: SLOT_X[slot],
        y: SLOT_Y[slot],
        z: SLOT_Z,
        color: result === 'WORD' ? COLORS.correct : COLORS.warm,
        power: result === 'WORD' ? 1.7 : 0.9,
      });
    } else {
      this.audio.play('wrong');
      this.shake = Math.min(1, this.shake + 0.25);
    }

    this.bus.emit('wordConnect', {
      type: result === 'WORD' ? 'WORD' : result === 'FAIL' ? 'FAIL' : 'LETTER',
      letter: result === 'FAIL' ? null : word[progressBefore] ?? null,
      word,
      wordsCompleted: this.wordConnect.wordsCompleted,
    });
    this.emitSnapshot();
  }

  /**
   * The payoff. Five correct answers and a solved word deserve more than one
   * more punch, so the damage is spent as a sequence: a wind-up the player can
   * feel building, a barrage that lengthens with every word connected, and one
   * finishing blow that lands in slow motion.
   *
   * Nothing here is a new system — it is the existing damage, impact, shake
   * and audio calls, spread across a second and a half instead of one frame.
   */
  private fireSpecialAttack(): void {
    const words = this.wordConnect.wordsCompleted;
    const damage = specialAttackDamage(words);

    // The mini game is over: the feet are back in play for the next question.
    this.input.motion.setMode('STANCE');
    this.phase = 'SPECIAL_ATTACK';
    // Earned and spent — the player can build another one from here.
    this.correctStreak = 0;

    const hits = damage > 0 ? 1 + words * SPECIAL_HITS_PER_WORD : 0;
    this.specialFinisher = Math.round(damage * SPECIAL_FINISHER_SHARE);
    this.specialPool = damage - this.specialFinisher;
    this.specialHitsLeft = hits;
    this.specialHitTimer = 0;
    this.specialCharge = 0;

    if (hits > 0) {
      this.specialStage = 'WINDUP';
      this.specialRemaining = SPECIAL_WINDUP_SECONDS;
      this.audio.play('specialCharge');
    } else {
      // Nothing was connected, so there is nothing to swing. Skip to the tail.
      this.specialStage = 'FINISH';
      this.specialRemaining = RESOLVE_DELAY;
    }

    this.bus.emit('special', { damage, wordsCompleted: words });
    this.bus.emit('wordConnect', {
      type: 'END',
      letter: null,
      word: '',
      wordsCompleted: words,
    });
    this.emitSnapshot();
  }

  private tickSpecialAttack(dt: number): void {
    switch (this.specialStage) {
      case 'WINDUP': {
        this.specialRemaining -= dt;
        // The rumble builds instead of decaying, which is what makes the
        // release land — the player has been braced for it for a second.
        this.specialCharge = clamp01(1 - this.specialRemaining / SPECIAL_WINDUP_SECONDS);
        this.shake = Math.min(0.55, this.shake + dt * 1.2);
        if (this.specialRemaining <= 0) {
          this.specialStage = 'BARRAGE';
          this.specialHitTimer = 0;
        }
        return;
      }

      case 'BARRAGE': {
        this.specialHitTimer -= dt;
        // A long frame can owe several blows; pay all of them.
        while (this.specialHitTimer <= 0 && this.specialStage === 'BARRAGE') {
          this.specialHitTimer += SPECIAL_HIT_INTERVAL;
          this.landSpecialHit();
        }
        return;
      }

      case 'FINISH': {
        this.specialRemaining -= dt;
        if (this.specialRemaining > 0) return;
        if (!this.monster.alive) {
          this.endGame('VICTORY');
          return;
        }
        this.monster.settle(this.elapsed);
        // A special attack is the likeliest thing to knock the monster past a
        // flee threshold, so this is where the chase most often begins.
        if (this.maybeStartChase()) return;
        this.resumeAnswering(RESOLVE_DELAY);
        return;
      }
    }
  }

  /** One blow of the barrage — or the last one, which ends the sequence. */
  private landSpecialHit(): void {
    if (this.specialHitsLeft <= 1 || !this.monster.alive) {
      this.landFinisher();
      return;
    }

    this.specialHitsLeft -= 1;
    // Spread what is left over the blows that are left, so the barrage always
    // adds up to exactly the damage the player was promised.
    const chunk = Math.max(1, Math.round(this.specialPool / this.specialHitsLeft));
    this.specialPool = Math.max(0, this.specialPool - chunk);
    this.dealSpecial(chunk, 0.35);
  }

  private landFinisher(): void {
    this.specialHitsLeft = 0;
    this.specialStage = 'FINISH';
    this.specialRemaining = SPECIAL_FINISH_SECONDS;
    this.slowMoRemaining = SPECIAL_SLOWMO_SECONDS;

    this.dealSpecial(this.specialFinisher + this.specialPool, 1);
    this.specialPool = 0;
    this.audio.play('special');

    // Three more bursts fanned around the monster, so the last blow throws
    // debris across the whole screen rather than out of one point.
    for (const [x, y] of FINISHER_BURSTS) {
      this.bus.emit('impact', {
        x,
        y: MONSTER_Y + y,
        z: MONSTER_Z + 3,
        color: COLORS.warm,
        power: 2.6,
      });
    }
  }

  /** Applies one blow of the special attack, at `weight` of full intensity. */
  private dealSpecial(amount: number, weight: number): void {
    const finisher = weight >= 1;
    const dealt = this.strikeMonster(amount, true, null, 0.7 + weight * 1.1);
    // The barrage is capped well below full so the finisher still has
    // somewhere to go — a screen that is already white cannot flash.
    this.specialBlast = finisher
      ? 1
      : Math.min(0.55, this.specialBlast + 0.16 + weight * 0.45);
    this.shake = Math.min(1, this.shake + 0.25 + weight * 0.75);
    // Every blow spends some of the charge that was built up for it.
    this.specialCharge = Math.max(0, this.specialCharge - 0.3);
    if (dealt > 0) this.score.bonus(dealt * SPECIAL_SCORE_PER_DAMAGE);
    // Publish per blow, so the health bar drops in step with the barrage
    // instead of catching up a second later. Ten renders across the whole
    // attack is still the discrete-event path, not a per-frame one.
    this.emitSnapshot();
  }

  // ------------------------------------------------------------ kart chase --

  /**
   * A hurt monster does not stand and take it: past each health threshold it
   * turns and runs down the tunnel, and the fight becomes a chase.
   *
   * Gated on the level for the same reason the counter-attack is — level 1 is
   * the diagnostic round, whose whole job is to measure English without the
   * fight getting in the way. A driving game is exactly the kind of thing that
   * would get in the way, so it starts at level 2.
   *
   * @returns true when the chase actually began and the caller should stop.
   */
  private maybeStartChase(): boolean {
    if (this.level <= DIAGNOSTIC_LEVEL) return false;
    if (!this.monster.alive) return false;

    // One blow can cross more than one threshold. Spend all of them, and run
    // one chase, rather than queueing a second for the next correct answer.
    let crossed = false;
    while (
      this.chasesSpent < KART_CHASE_HP_TRIGGERS.length &&
      this.monster.hpFraction <= KART_CHASE_HP_TRIGGERS[this.chasesSpent]
    ) {
      this.chasesSpent += 1;
      crossed = true;
    }
    if (!crossed) return false;

    return this.startKartChase();
  }

  private startKartChase(): boolean {
    const topic = pickTopic(this.lastChaseTopic);
    this.lastChaseTopic = topic.id;

    this.clearTargets();
    this.kart.start(topic, KART_WAVES, this.settings.speed);
    this.phase = 'KART_CHASE';
    // The feet are the steering. Answering already drives this channel, so a
    // tilt sensor needs no second mapping to work here — the same normalised
    // -1..1 body position that walks between answers now steers between lanes.
    this.input.motion.setMode('STANCE');
    this.audio.play('charge');
    this.emitChase('START', null, null, 0);
    return true;
  }

  private tickKartChase(dt: number): void {
    const before = this.kart.status;
    const result = this.kart.tick(dt, this.elapsed, this.input.lane);

    if (this.kart.justSpawned) this.emitChase('WAVE', null, null, 0);
    for (const gate of this.kart.drainResults()) this.resolveGate(gate);

    // The instant the chase is decided, so the panel can show how it went
    // while the rows already in the air are still flying past.
    if (this.kart.status !== before && this.kart.status !== 'DONE') this.emitSnapshot();

    if (result === 'DONE') this.finishKartChase();
  }

  /**
   * One row of pictures went past. Nothing the player did committed this — the
   * row arriving did, which is the whole difference between this mini game and
   * the other two.
   */
  private resolveGate(gate: KartGateResult): void {
    if (gate.outcome === 'COLLECT') {
      // Bonus points, never `award` — the chase answers no questions, so it
      // must not move accuracy or the learner model.
      this.score.bonus(KART_SCORE_PER_PICTURE);
      this.audio.play('letter', this.kart.collected);
      this.shake = Math.min(1, this.shake + 0.14);
      // Ground made up: the camera surges and the monster is hauled a step in.
      this.chaseLurch = 1;
      this.bus.emit('impact', {
        x: KART_LANE_X[gate.lane],
        y: KART_BLOCK_Y,
        z: STRIKE_Z,
        color: COLORS.correct,
        power: 1.1,
      });
    } else if (gate.outcome === 'CRASH') {
      this.audio.play('wrong');
      this.shake = 1;
      // ...and ground lost: a jolt that throws the camera off its line.
      this.chaseSlam = 1;
      this.bus.emit('impact', {
        x: KART_LANE_X[gate.lane],
        y: KART_BLOCK_Y,
        z: STRIKE_Z,
        color: COLORS.wrong,
        power: 1.7,
      });
    }

    this.emitChase(gate.outcome, gate.word, gate.lane, 0);
  }

  private finishKartChase(): void {
    const caught = this.kart.caught;
    const damage = chaseDamage(this.kart.collected, caught);

    // Announced while the chase is still readable, then cleared — and the
    // clearing is announced too. Without that second event the scene keeps
    // rendering the block list it last mirrored: those objects are no longer
    // ticked by anyone, and a row still `INCOMING` when the chase ended has no
    // fade to run, so it hangs in the tunnel through the next question.
    this.emitChase(caught ? 'CAUGHT' : 'ESCAPED', null, null, damage);
    this.kart.reset();
    this.emitChase('END', null, null, damage);

    if (damage > 0) {
      // Running it down is a ram, not a punch — but it spends the same damage,
      // impact and slow-motion machinery the special attack does.
      this.strikeMonster(damage, true, null, caught ? 1.9 : 1.1);
      this.specialBlast = caught ? 1 : 0.45;
      this.shake = 1;
      this.chaseLurch = 1;
      if (caught) {
        this.slowMoRemaining = SPECIAL_SLOWMO_SECONDS;
        this.audio.play('special');
      }
    }

    if (!this.monster.alive) {
      this.endGame('VICTORY');
      return;
    }
    this.monster.settle(this.elapsed);
    this.resumeAnswering(RESOLVE_DELAY);
  }

  private emitChase(
    type: GameEvents['kartChase']['type'],
    word: string | null,
    lane: number | null,
    damage: number,
  ): void {
    this.bus.emit('kartChase', {
      type,
      topic: this.kart.topic,
      word,
      lane,
      collected: this.kart.collected,
      gap: this.kart.gap,
      damage,
    });
    this.emitSnapshot();
  }

  // ----------------------------------------------------------- snapshotting --

  /** Seconds since the manager started ticking — the scene's animation clock. */
  get time(): number {
    return this.elapsed;
  }

  get praise(): string {
    return PRAISE[this.praiseIndex];
  }

  getStats(): SessionStats {
    return {
      score: this.score.value,
      combo: this.combo.current,
      bestCombo: this.combo.bestCombo,
      multiplier: this.combo.multiplier,
      correct: this.score.correctCount,
      wrong: this.score.wrongCount,
      missed: this.score.missedCount,
      answered: this.score.answered,
      totalQuestions: SESSION_QUESTIONS,
      accuracy: this.score.accuracy,
      averageReaction: this.score.averageReaction,
      difficulty: this.difficulty.difficulty,
    };
  }

  getCombat(): CombatSnapshot {
    return {
      level: this.level,
      diagnostic: this.level <= DIAGNOSTIC_LEVEL,
      phase: this.phase,
      monsterPhase: this.monster.phase,
      monsterHp: this.monster.hp,
      monsterMaxHp: this.monster.maxHp,
      playerHp: this.playerHp,
      playerMaxHp: PLAYER_MAX_HP,
      correctStreak: this.correctStreak,
      streakTarget: WORD_CONNECT_STREAK,
      chargeRemaining:
        this.phase === 'MONSTER_CHARGING' ? this.monster.chargeRemaining : null,
      guarding: this.input.isGuarding(),
      stance: this.input.stance,
      roundOutcome: this.roundOutcome,
    };
  }

  getSnapshot(): GameSnapshot {
    return {
      state: this.state,
      question: this.currentQuestion,
      questionNumber: this.questionNumber,
      totalQuestions: SESSION_QUESTIONS,
      timeRemaining: this.timeRemaining,
      countdown: this.lastCountdownValue,
      stats: this.getStats(),
      lastOutcome: this.lastOutcome,
      coach: this.coach,
      combat: this.getCombat(),
      wordConnect: this.wordConnect.snapshot(),
      kartChase: this.kart.snapshot(),
      review: this.review,
    };
  }

  private emitSnapshot(): void {
    this.publish(this.getSnapshot());
  }

  dispose(): void {
    this.unsubscribePunch?.();
    this.unsubscribeGuard?.();
    this.input.dispose();
    this.audio.dispose();
    this.bus.clear();
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
/** Frame-rate independent exponential approach. */
const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

/** Distance from the strike plane decides how clean the punch was. */
function gradeHit(z: number): HitQuality {
  const distance = Math.abs(z - STRIKE_Z);
  if (distance <= HIT_WINDOW.PERFECT) return 'PERFECT';
  if (distance <= HIT_WINDOW.GREAT) return 'GREAT';
  if (distance <= HIT_WINDOW.GOOD) return 'GOOD';
  return 'EARLY';
}
