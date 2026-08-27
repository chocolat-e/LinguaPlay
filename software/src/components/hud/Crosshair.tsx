import { useEffect, useRef } from 'react';
import { game } from '../../game/instance';

/**
 * Punch reticle that tracks the mouse. Position is written straight to the
 * element's transform on pointermove — no React state, so it never triggers a
 * render during gameplay.
 */
export function Crosshair() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let releaseTimer = 0;

    const move = (event: PointerEvent) => {
      node.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    };

    const strike = () => {
      node.classList.add('is-punching');
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => node.classList.remove('is-punching'), 110);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', strike);
    const offPunch = game.bus.on('punch', strike);

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', strike);
      window.clearTimeout(releaseTimer);
      offPunch();
    };
  }, []);

  return <div ref={ref} className="crosshair" />;
}
