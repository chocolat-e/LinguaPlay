import { useBridgeStatus } from '../../hooks/useBridgeStatus';

/**
 * Whether the physical devices are actually connected.
 *
 * Worth its own line on screen because the failure is otherwise silent: a
 * controller on the wrong network, or a vision script that was never started,
 * both look exactly like a game that has decided to ignore you. Nothing here
 * is a control — the keyboard always works, so there is no mode to be in.
 */
export function DeviceStatus() {
  const status = useBridgeStatus();

  return (
    <div className="devices" role="status">
      <span className={`devices__item${status.controller ? ' is-on' : ''}`}>
        Controller
      </span>
      <span className={`devices__item${status.vision ? ' is-on' : ''}`}>
        Camera
      </span>
      {!status.controller && !status.vision && (
        <span className="devices__hint">
          {status.error ? 'bridge offline · keyboard ready' : 'keyboard ready'}
        </span>
      )}
    </div>
  );
}
