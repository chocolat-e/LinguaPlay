/** Shared domain types. Pure data — no React, no Three.js. */

export type Difficulty = 'easy' | 'medium' | 'hard';

export type Category =
  | 'vocabulary'
  | 'grammar'
  | 'synonym'
  | 'antonym'
  | 'sentence'
  | 'everyday';

export interface Question {
  id: number;
  question: string;
  /**
   * Four entries as authored. `QuestionManager` serves each item trimmed to
   * three — one per lane (L/C/R) — so gameplay only ever sees three.
   */
  answers: string[];
  /** Index into `answers`. */
  correctAnswer: number;
  difficulty: Difficulty;
  category: Category;
  /** Fine-grained skill tracked by PunchKT (for example, present-simple-3sg). */
  knowledgeComponent?: string;
  /** What this item is intended to teach or measure. */
  learningObjective?: string;
  /** Short explanation shown to the learner after the round. */
  explanation?: string;
  /** Misconception represented by each option; aligned with `answers`. */
  misconceptions?: string[];
  /** Whether this item came with the game or from the between-level coach. */
  source?: 'static' | 'llm' | 'local';
  /** Why the curriculum planner included this item. */
  curriculumReason?: string;
}

export type GameState =
  | 'MENU'
  | 'HOW_TO_PLAY'
  | 'SETTINGS'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'PAUSED'
  | 'GAME_OVER'
  | 'RESULTS';

/** Which of the three standing positions the player occupies. */
export type Stance = 0 | 1 | 2;

/** Facing used by the word-connect mini game, where slots sit on both axes. */
export type MoveDirection = 'UP' | 'RIGHT' | 'DOWN' | 'LEFT';

/**
 * Which part of the player a movement signal is steering.
 *
 * `STANCE` is the answer phase: the feet walk between LEFT · CENTER · RIGHT.
 * `REACH` is Word Connect: the feet are planted in the centre and the same
 * signal aims the hand at one of the four letter slots instead.
 */
export type MotionMode = 'STANCE' | 'REACH';

/**
 * Where the battle is *inside* a PLAYING round.
 *
 * `GameState` keeps owning the coarse screen routing exactly as before; this is
 * the finer combat machine running underneath it. Deliberately a second field
 * rather than more `GameState` members, so there is still one state system and
 * every screen, input gate, and scene filter keeps working unchanged.
 */
export type CombatPhase =
  | 'ANSWERING'          // a question is live; move, then punch
  | 'RESOLVING'          // answered; brief beat before the next question
  | 'MONSTER_CHARGING'   // wind-up; the defence window is inside this
  | 'MONSTER_STRIKING'   // the blow has landed or been blocked
  | 'WORD_CONNECT'       // the earned mini game
  | 'SPECIAL_ATTACK';    // the payoff from the mini game

export type MonsterPhase = 'IDLE' | 'HURT' | 'CHARGING' | 'STRIKING' | 'DEFEATED';

/** Why the round ended. */
export type RoundOutcome = 'TIME' | 'QUESTIONS' | 'VICTORY' | 'DEFEAT';

export interface CombatSnapshot {
  level: number;
  /** True on the diagnostic level, where the monster may not counter-attack. */
  diagnostic: boolean;
  phase: CombatPhase;
  monsterPhase: MonsterPhase;
  monsterHp: number;
  monsterMaxHp: number;
  playerHp: number;
  playerMaxHp: number;
  correctStreak: number;
  streakTarget: number;
  /** Seconds until the blow lands, or null when the monster is not charging. */
  chargeRemaining: number | null;
  /** True while the player's guard is actually up. */
  guarding: boolean;
  stance: Stance | null;
  roundOutcome: RoundOutcome | null;
}

export interface WordConnectSlot {
  /** 0..3 → UP · RIGHT · DOWN · LEFT. */
  index: number;
  letter: string;
  direction: MoveDirection;
  /** Position in the word this slot was connected for, or null if untouched. */
  usedAt: number | null;
}

export interface WordConnectSnapshot {
  active: boolean;
  word: string;
  /** How many letters of `word` are connected so far. */
  progress: number;
  slots: WordConnectSlot[];
  wordIndex: number;
  totalWords: number;
  wordsCompleted: number;
  timeRemaining: number;
  status: 'PLAYING' | 'COMPLETE' | 'FAILED' | 'DONE';
}

/** How cleanly the punch landed relative to the strike plane. */
export type HitQuality = 'PERFECT' | 'GREAT' | 'GOOD' | 'EARLY';

export type Outcome = 'CORRECT' | 'WRONG' | 'MISS';

/** Lifecycle of a single answer target. */
export type TargetState =
  | 'INCOMING'
  | 'HIT'        // punched by the player
  | 'REVEAL'     // the correct answer, revealed after a wrong punch
  | 'FADE'       // sibling of a hit target, dissolving away
  | 'ESCAPED';   // flew past the player untouched

export interface TargetRuntime {
  id: number;
  /** 0..2 → LEFT/CENTER/RIGHT. Lane index doubles as the answer index. */
  lane: number;
  label: string;
  isCorrect: boolean;
  x: number;
  y: number;
  z: number;
  speed: number;
  /** Simulation time at which the entry rush ends and the read hold begins. */
  entryUntil: number;
  /**
   * Simulation time at which this block stops holding still and starts its
   * approach. Until then the player is reading, not reacting.
   */
  holdUntil: number;
  state: TargetState;
  /** performance.now()/1000 at the moment the state last changed. */
  stateTime: number;
  spawnedAt: number;
}

export interface AnswerRecord {
  questionId: number;
  difficulty: Difficulty;
  category: Category;
  outcome: Outcome;
  /** Seconds between the question appearing and the punch. */
  reactionTime: number;
  quality: HitQuality | null;
  /** Selected lane/answer. Null means no punch landed. */
  selectedAnswer: number | null;
  correctAnswer: number;
  selectedText: string | null;
  correctText: string;
  knowledgeComponent: string;
  /** Wrong-answer hypothesis supplied by the item author/LLM. */
  misconception: string | null;
  /** Unix time enables forgetting estimates across browser sessions. */
  recordedAt: number;
}

/**
 * One question the player did not get right, kept so the results screen can
 * show the right answer and why. Display copy only — the learner model reads
 * `AnswerRecord`, never this.
 */
export interface ReviewItem {
  questionId: number;
  question: string;
  /** What the player punched, or null when no punch landed in time. */
  yourAnswer: string | null;
  correctAnswer: string;
  /** Plain-language reason the correct answer is the right one. */
  explanation: string;
}

export interface SessionStats {
  score: number;
  combo: number;
  bestCombo: number;
  multiplier: number;
  correct: number;
  wrong: number;
  missed: number;
  answered: number;
  totalQuestions: number;
  accuracy: number;
  averageReaction: number;
  difficulty: Difficulty;
}

export interface GameSettings {
  musicVolume: number;
  sfxVolume: number;
  /** Multiplies target approach speed. */
  speed: number;
  adaptiveDifficulty: boolean;
  screenShake: boolean;
}
