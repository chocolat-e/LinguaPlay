import { useEffect } from 'react';
import { GameCanvas } from './components/scene/GameCanvas';
import { Hud } from './components/hud/Hud';
import { Countdown } from './components/screens/Countdown';
import { GameMenu } from './components/screens/GameMenu';
import { HowToPlay } from './components/screens/HowToPlay';
import { PauseScreen } from './components/screens/PauseScreen';
import { ResultsScreen } from './components/screens/ResultsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { game } from './game/instance';
import { useGameState } from './hooks/useGameState';
import './styles/game.css';

/**
 * Routes the current game state to a screen. The 3D canvas stays mounted the
 * whole time so the tunnel keeps flying behind every menu — and so the game
 * loop never has to be torn down and rebuilt.
 */
export default function App() {
  const state = useGameState();

  // Esc pauses and resumes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      game.togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pause automatically when the tab loses focus, so nothing runs unseen.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) game.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const playing = state === 'PLAYING' || state === 'PAUSED' || state === 'GAME_OVER';

  return (
    <div className={`app${playing ? ' app--playing' : ''}`}>
      <div className="stage">
        <GameCanvas />
      </div>

      {playing && <Hud />}

      {state === 'MENU' && <GameMenu />}
      {state === 'HOW_TO_PLAY' && <HowToPlay />}
      {state === 'SETTINGS' && <SettingsScreen />}
      {state === 'COUNTDOWN' && <Countdown />}
      {state === 'PAUSED' && <PauseScreen />}
      {state === 'RESULTS' && <ResultsScreen />}
    </div>
  );
}
