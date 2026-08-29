import { useGameStore } from '../store/gameStore';

/** Narrow selectors so each HUD widget repaints only when its own data moves. */
export const useGameState = () => useGameStore((s) => s.snapshot.state);
export const useQuestion = () => useGameStore((s) => s.snapshot.question);
export const useStats = () => useGameStore((s) => s.snapshot.stats);
export const useTimeRemaining = () =>
  useGameStore((s) => Math.ceil(s.snapshot.timeRemaining));
export const useLastOutcome = () => useGameStore((s) => s.snapshot.lastOutcome);
export const useCoach = () => useGameStore((s) => s.snapshot.coach);
export const useSettings = () => useGameStore((s) => s.settings);
export const useCombat = () => useGameStore((s) => s.snapshot.combat);
export const useWordConnect = () => useGameStore((s) => s.snapshot.wordConnect);
export const useKartChase = () => useGameStore((s) => s.snapshot.kartChase);
export const useReview = () => useGameStore((s) => s.snapshot.review);
