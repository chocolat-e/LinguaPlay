import type { GameState } from '../types';
import type { BridgeUiIntent } from './BridgeSource';

/**
 * The controller's stick and button, driving the interface.
 *
 * The other half of the hardware split: `BridgeSource` carries what the player
 * does with their body into the simulation, and this carries what they do with
 * their thumb into the menus. Nothing here can touch gameplay — the only two
 * things it does are move the browser's focus and click what is focused, which
 * is exactly what the keyboard already does with Tab and Enter.
 *
 * Pause is the one verb it owns outright, because during a fight there is no
 * focused control to press: the button asks the game to pause, and on the
 * pause screen it presses Resume, which is the same button doing the same
 * obvious thing in both directions.
 */

/** The slice of `GameManager` the menus need. Kept narrow so this is testable. */
export interface MenuTarget {
  getState(): GameState;
  pause(): void;
  uiSound(): void;
}

/**
 * Focusable controls, in the order the player sees them.
 *
 * Scoped to the open modal on purpose. Every screen wraps itself in
 * `.layer--modal` and the HUD does not, so this both finds the buttons of
 * whichever screen is up and refuses to find any while a fight is running —
 * the HUD's own Pause button included, which the stick has no business
 * highlighting mid-question.
 */
function focusable(): HTMLElement[] {
  if (typeof document === 'undefined') return [];

  const modals = document.querySelectorAll<HTMLElement>('.layer--modal');
  const open = modals[modals.length - 1];
  if (!open) return [];

  return Array.from(open.querySelectorAll<HTMLElement>('[data-ui]')).filter(
    (element) => !element.hasAttribute('disabled') && element.offsetParent !== null,
  );
}

export class HardwareMenu {
  private readonly game: MenuTarget;

  constructor(game: MenuTarget) {
    this.game = game;
  }

  apply(intent: BridgeUiIntent): void {
    if (intent.step !== 0) this.step(intent.step);
    if (intent.press) this.press();
  }

  /**
   * Move the highlight, wrapping at both ends.
   *
   * Wrapping rather than clamping because the stick reports a flick, not a
   * position: with three items and no wrap, a player who flicks past the last
   * one has no way of knowing whether the stick or the game stopped
   * responding.
   */
  private step(direction: number): void {
    const items = focusable();
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      current === -1
        ? // Focus is somewhere else entirely — a click on the background, a
          // screen that has just opened. The first item is where a stick
          // pushed forward should land, and the last where one pushed back
          // should.
          direction > 0
          ? 0
          : items.length - 1
        : (current + direction + items.length) % items.length;

    items[next].focus();
    this.game.uiSound();
  }

  /**
   * Press: pause the fight, or activate whatever is highlighted.
   *
   * Resuming is deliberately *not* a case here. The pause screen puts the
   * focus on Resume, so pressing the button again clicks it — the toggle falls
   * out of the menu rather than being a second meaning bolted onto the button.
   */
  private press(): void {
    if (this.game.getState() === 'PLAYING') {
      this.game.uiSound();
      this.game.pause();
      return;
    }

    const items = focusable();
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    // Nothing focused means the player has not moved the stick yet. The first
    // control is the primary one on every screen, so pressing without aiming
    // does the obvious thing rather than nothing.
    items[current === -1 ? 0 : current].click();
  }
}
