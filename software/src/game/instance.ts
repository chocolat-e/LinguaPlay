import { GameManager } from './GameManager';

/**
 * One simulation for the whole app. Kept outside React so hot reloads and
 * re-renders never spin up a second game loop.
 */
export const game = new GameManager();

if (import.meta.env.DEV) {
  // Handy for poking at the simulation from the browser console.
  (window as unknown as { game: GameManager }).game = game;
}
