import { AudioManager } from './AudioManager';
import { PunchKTLearner } from '../adaptive/PunchKTLearner';
import { requestAdaptivePlan } from '../adaptive/coachClient';
import { knowledgeComponentFor, misconceptionFor } from '../adaptive/questionProfile';
import { selectNextLevelStartDifficulty } from '../adaptive/startDifficulty';
import { ComboManager } from './ComboManager';
import { DifficultyManager } from './DifficultyManager';
import { QuestionManager } from './QuestionManager';
import { ScoreManager } from './ScoreManager';
import { EventBus } from './events';
import { InputManager, KeyboardSource } from './input';
import type { PunchEvent } from './input';
import {
  APPROACH_TIME,
  COLORS,
  COUNTDOWN_SECONDS,
  DESPAWN_Z,
  ENTRY_TIME,
  GAME_OVER_SECONDS,
  HIT_WINDOW,
  LANE_X,
  LANE_Y,
  PLAYER_HAND,
  READ_TIME,
  READ_Z,
  RESOLVE_DELAY,
  SESSION_QUESTIONS,
  SESSION_SECONDS,
  SPAWN_Z,
  STRIKE_Z,
} from './constants';
import type {
  AnswerRecord,
  Difficulty,
  GameSettings,
  GameState,
  HitQuality,
  Question,
  SessionStats,
  TargetRuntime,
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
    outcome: 'CORRECT' | 'WRONG' | 'MISS';
    quality: HitQuality | null;
    points: number;
    combo: number;
    /** Bumped on every resolution so the HUD can re-key its animations. */
    seq: number;
  } | null;
  coach: CoachState;
}

const DEFAULT_SETTINGS: GameSettings = {
  musicVolume: 0.45,
  sfxVolume: 0.8,
  speed: 1,
  adaptiveDifficulty: true,
  screenShake: true,
};

const PRAISE = ['PERFECT!', 'NICE!', 'GREAT!', 'CRUSHED IT!', 'BOOM!'];

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

  /** Live targets. Mutated in place every frame; never reallocated per frame. */
  readonly targets: TargetRuntime[] = [];

  settings: GameSettings = { ...DEFAULT_SETTINGS };

  /** Camera shake energy, 0..1, decayed each frame by the scene. */
  shake = 0;
  /** Rises to 1 on every musical beat and falls back — drives scene pulsing. */
  beatPulse = 0;

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
  private coach: CoachState = { status: 'idle', package: null, message: null };

  private publish: (snapshot: GameSnapshot) => void = () => {};
  private unsubscribePunch: (() => void) | null = null;

  constructor() {
    this.unsubscribePunch = this.input.onPunch(this.handlePunch);
    this.input.addSource(new KeyboardSource());
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
    this.input.setEnabled(true);
    this.input.setAimLane(null);
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
    const dt = Math.min(rawDelta, 0.05);
    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.2);

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
    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endGame();
      return;
    }

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
      this.resolveMiss();
    }

    if (this.resolved && this.elapsed >= this.nextSpawnAt) {
      if (this.score.answered >= SESSION_QUESTIONS) this.endGame();
      else this.spawnQuestion();
    }

    const second = Math.ceil(this.timeRemaining);
    if (second !== this.lastPublishedSecond) {
      this.lastPublishedSecond = second;
      this.emitSnapshot();
    }
  }

  private endGame(): void {
    if (this.sessionFinalized) return;
    this.sessionFinalized = true;
    this.clearTargets();
    this.audio.stopMusic();
    this.audio.play('gameover');
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
      this.endGame();
      return;
    }

    this.clearTargets();
    this.currentQuestion = question;
    this.questionNumber += 1;
    this.resolved = false;
    this.questionShownAt = this.elapsed;

    const approach = APPROACH_TIME[question.difficulty] / Math.max(0.4, this.settings.speed);
    const speed = (STRIKE_Z - READ_Z) / approach;
    const entryUntil = this.elapsed + ENTRY_TIME;
    const holdUntil = entryUntil + READ_TIME[question.difficulty];

    for (let lane = 0; lane < 4; lane += 1) {
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
   */
  private handlePunch = (event: PunchEvent): void => {
    if (this.state !== 'PLAYING') return;

    const lane = event.laneIndex;
    this.bus.emit('punch', { hand: PLAYER_HAND, lane });
    const target =
      lane === null
        ? null
        : this.targets.find((t) => t.lane === lane && t.state === 'INCOMING') ?? null;

    if (!target || this.resolved) {
      this.audio.play('whiff');
      this.shake = Math.min(1, this.shake + 0.08);
      this.bus.emit('whiff', { lane });
      return;
    }
    this.resolveHit(target, event);
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

  private resolveMiss(): void {
    const question = this.currentQuestion;
    if (!question || this.resolved) return;

    this.resolved = true;
    this.nextSpawnAt = this.elapsed + RESOLVE_DELAY * 0.6;
    this.combo.break();
    this.score.registerMiss();
    this.audio.play('wrong');
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
    );
  }

  private finishQuestion(
    question: Question,
    outcome: 'CORRECT' | 'WRONG' | 'MISS',
    quality: HitQuality | null,
    points: number,
    reactionTime: number,
    lane: number | null,
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
    };
  }

  private emitSnapshot(): void {
    this.publish(this.getSnapshot());
  }

  dispose(): void {
    this.unsubscribePunch?.();
    this.input.dispose();
    this.audio.dispose();
    this.bus.clear();
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Distance from the strike plane decides how clean the punch was. */
function gradeHit(z: number): HitQuality {
  const distance = Math.abs(z - STRIKE_Z);
  if (distance <= HIT_WINDOW.PERFECT) return 'PERFECT';
  if (distance <= HIT_WINDOW.GREAT) return 'GREAT';
  if (distance <= HIT_WINDOW.GOOD) return 'GOOD';
  return 'EARLY';
}
