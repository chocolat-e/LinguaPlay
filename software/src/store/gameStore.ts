import { create } from 'zustand';
import type { GameSnapshot } from '../game/GameManager';
import { game } from '../game/instance';
import type { GameSettings } from '../game/types';

interface GameStore {
  snapshot: GameSnapshot;
  settings: GameSettings;
  setSnapshot: (snapshot: GameSnapshot) => void;
  updateSettings: (partial: Partial<GameSettings>) => void;
}

/**
 * Display-only mirror of the simulation. `setSnapshot` is called on discrete
 * events (question change, punch resolved, each whole second) — never once per
 * frame — so React re-renders stay off the hot path.
 */
export const useGameStore = create<GameStore>((set) => ({
  snapshot: game.getSnapshot(),
  settings: game.settings,
  setSnapshot: (snapshot) => set({ snapshot }),
  updateSettings: (partial) => {
    game.applySettings(partial);
    set({ settings: { ...game.settings } });
  },
}));

// Wire the simulation to the store exactly once, at module load.
game.setPublisher((snapshot) => useGameStore.getState().setSnapshot(snapshot));
