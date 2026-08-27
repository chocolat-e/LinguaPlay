import { game } from '../../game/instance';
import { useSettings } from '../../hooks/useGameState';
import { useGameStore } from '../../store/gameStore';

export function SettingsScreen() {
  const settings = useSettings();
  const update = useGameStore((s) => s.updateSettings);

  return (
    <div className="layer layer--modal">
      <div className="panel settings">
        <h2 className="panel__title">Settings</h2>

        <div className="field">
          <label className="field__label" htmlFor="music">
            Music <b>{Math.round(settings.musicVolume * 100)}%</b>
          </label>
          <input
            id="music"
            data-ui
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.musicVolume}
            onChange={(e) => update({ musicVolume: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sfx">
            Sound effects <b>{Math.round(settings.sfxVolume * 100)}%</b>
          </label>
          <input
            id="sfx"
            data-ui
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.sfxVolume}
            onChange={(e) => update({ sfxVolume: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="speed">
            Block speed <b>{settings.speed.toFixed(2)}×</b>
          </label>
          <input
            id="speed"
            data-ui
            type="range"
            min={0.6}
            max={1.8}
            step={0.05}
            value={settings.speed}
            onChange={(e) => update({ speed: Number(e.target.value) })}
          />
        </div>

        <div className="toggle">
          <span>Adaptive difficulty</span>
          <button
            type="button"
            data-ui
            className={settings.adaptiveDifficulty ? 'is-on' : ''}
            onClick={() => update({ adaptiveDifficulty: !settings.adaptiveDifficulty })}
          >
            {settings.adaptiveDifficulty ? 'On' : 'Off'}
          </button>
        </div>

        <div className="toggle">
          <span>Screen shake</span>
          <button
            type="button"
            data-ui
            className={settings.screenShake ? 'is-on' : ''}
            onClick={() => update({ screenShake: !settings.screenShake })}
          >
            {settings.screenShake ? 'On' : 'Off'}
          </button>
        </div>

        <button
          type="button"
          data-ui
          className="btn btn--primary"
          onClick={() => {
            game.uiSound();
            game.goToMenu();
          }}
        >
          Back to menu
        </button>
      </div>
    </div>
  );
}
