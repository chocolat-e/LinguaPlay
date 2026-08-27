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
  /** Always 4 entries — one per lane (A/B/C/D). */
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
  /** 0..3 → A/B/C/D. Lane index doubles as the answer index. */
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
