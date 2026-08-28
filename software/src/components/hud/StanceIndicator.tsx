import { useEffect, useRef } from 'react';
import { LANE_NAMES, SLOT_DIRECTIONS } from '../../game/constants';
import { game } from '../../game/instance';

/**
 * What the player is aiming with, and where.
 *
 * While answering that is the feet: a track with a marker sliding along it and
 * the three zones lighting up as you enter them. During Word Connect the feet
 * are out of it entirely, so the same panel switches to a four-way pad showing
 * where the hand is reaching.
 *
 * Both change every frame, so — like the crosshair — this writes straight to
 * the elements' styles from a rAF loop rather than holding React state. No
 * render ever happens while the player moves.
 */
export function StanceIndicator() {
  const root = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const zones = useRef<Array<HTMLSpanElement | null>>([]);
  const hand = useRef<HTMLSpanElement>(null);
  const arms = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    let frame = 0;
    let lastStance: number | null | undefined;
    let lastSlot: number | null | undefined;
    let lastMode: string | undefined;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const box = root.current;
      const node = marker.current;
      const dot = hand.current;
      if (!box || !node || !dot) return;

      const motion = game.input.motion;
      if (motion.mode !== lastMode) {
        lastMode = motion.mode;
        box.dataset.mode = motion.mode.toLowerCase();
      }

      if (motion.mode === 'REACH') {
        // The pad is a square percentage box, so -1..1 remaps to 0..100 with
        // the y axis flipped — up on the axis is up on the screen.
        dot.style.left = `${(motion.handX + 1) * 50}%`;
        dot.style.top = `${(1 - motion.handY) * 50}%`;

        const slot = motion.slotIndex;
        if (slot === lastSlot) return;
        lastSlot = slot;
        dot.dataset.locked = slot === null ? 'false' : 'true';
        arms.current.forEach((arm, index) => {
          arm?.classList.toggle('is-active', index === slot);
        });
        return;
      }

      // x runs -1..1 and the track is a percentage box, so remap to 0..100.
      node.style.left = `${(motion.x + 1) * 50}%`;

      const stance = motion.stance;
      if (stance === lastStance) return;
      lastStance = stance;
      node.dataset.locked = stance === null ? 'false' : 'true';
      zones.current.forEach((zone, index) => {
        zone?.classList.toggle('is-active', index === stance);
      });
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={root} className="stance" data-mode="stance">
      <div className="stance__feet">
        <div className="stance__track">
          <span ref={marker} className="stance__marker" data-locked="true" />
        </div>
        <div className="stance__zones">
          {LANE_NAMES.map((name, index) => (
            <span
              key={name}
              ref={(node) => {
                zones.current[index] = node;
              }}
              className="stance__zone"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="stance__hand">
        <div className="reachpad">
          {SLOT_DIRECTIONS.map((direction, index) => (
            <span
              key={direction}
              ref={(node) => {
                arms.current[index] = node;
              }}
              className={`reachpad__arm reachpad__arm--${direction.toLowerCase()}`}
            />
          ))}
          <span ref={hand} className="reachpad__hand" data-locked="false" />
        </div>
        <p className="stance__note">
          REACH TO CONNECT<b>no punch needed</b>
        </p>
      </div>
    </div>
  );
}
