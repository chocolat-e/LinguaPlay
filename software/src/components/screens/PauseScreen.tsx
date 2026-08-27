import { game } from '../../game/instance';

export function PauseScreen() {
  return (
    <div className="layer layer--modal">
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2 className="panel__title">Paused</h2>
        <div className="results__actions">
          <button
            type="button"
            data-ui
            className="btn btn--primary"
            autoFocus
            onClick={() => {
              game.uiSound();
              game.resume();
            }}
          >
            Resume
          </button>
          <button
            type="button"
            data-ui
            className="btn"
            onClick={() => {
              game.uiSound();
              game.restart();
            }}
          >
            Restart
          </button>
          <button
            type="button"
            data-ui
            className="btn btn--ghost"
            onClick={() => {
              game.uiSound();
              game.quitToMenu();
            }}
          >
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
