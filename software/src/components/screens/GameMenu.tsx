import { DeviceStatus } from '../hud/DeviceStatus';
import { game } from '../../game/instance';

export function GameMenu() {
  const act = (fn: () => void) => () => {
    game.uiSound();
    fn();
  };

  return (
    <div className="layer layer--modal">
      <div className="menu">
        <h1 className="logo">
          <span className="logo__line">PUNCH</span>
          <span className="logo__line logo__line--alt">ENGLISH</span>
        </h1>
        <p className="tagline">Rhythm boxing · vocabulary · grammar</p>

        <div className="menu__actions">
          <button
            type="button"
            data-ui
            className="btn btn--primary"
            onClick={act(() => game.startCountdown())}
            autoFocus
          >
            Play
          </button>
          <button
            type="button"
            data-ui
            className="btn"
            onClick={act(() => game.showHowToPlay())}
          >
            How to play
          </button>
          <button
            type="button"
            data-ui
            className="btn btn--ghost"
            onClick={act(() => game.showSettings())}
          >
            Settings
          </button>
        </div>

        <DeviceStatus />
      </div>
    </div>
  );
}
