import { GameManager } from './GameManager';
import { BridgeSource, HardwareFeedback, HardwareMenu } from './input';

/**
 * One simulation for the whole app. Kept outside React so hot reloads and
 * re-renders never spin up a second game loop.
 */
export const game = new GameManager();

/**
 * The physical devices, attached here rather than inside `GameManager`.
 *
 * The simulation stays free of network and device concerns — the unit tests
 * construct a `GameManager` directly and never open a socket — while the app
 * that actually has a bridge to talk to wires it up at the edge. That is the
 * same seam the architecture already draws around React.
 */
export const bridge = new BridgeSource();

export const hardwareFeedback = new HardwareFeedback(game.bus, () => game.getSnapshot());

/**
 * The stick and the button, wired to the menus rather than to `game.input`.
 *
 * Subscribed here, next to the other edge concerns, because it is DOM work:
 * it moves focus and clicks buttons, neither of which the simulation knows
 * anything about.
 */
export const hardwareMenu = new HardwareMenu(game);

// `VITE_BRIDGE=off` runs the game on the keyboard alone, for working on
// gameplay somewhere the hardware is not.
if (import.meta.env.VITE_BRIDGE !== 'off') {
  game.input.addSource(bridge);
  hardwareFeedback.start();
  bridge.onUi((intent) => hardwareMenu.apply(intent));
}

if (import.meta.env.DEV) {
  // Handy for poking at the simulation from the browser console.
  (window as unknown as { game: GameManager }).game = game;
}
