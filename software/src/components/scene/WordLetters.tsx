import { useCallback, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, SLOT_X, SLOT_Y, SLOT_Z } from '../../game/constants';
import { game } from '../../game/instance';
import type { WordConnectSlot } from '../../game/types';
import { useGameEvent } from '../../hooks/useGameEvent';
import { getLetterTexture } from '../../utils/answerTexture';

/**
 * The letters of the current word-connect puzzle, floating at the four points
 * around the player.
 *
 * Re-renders only when a word starts or ends — the per-frame highlight and
 * pulse are written straight to the Three.js objects, same as the answer
 * blocks.
 */
export function WordLetters() {
  const [slots, setSlots] = useState<WordConnectSlot[]>([]);

  const sync = useCallback(() => {
    setSlots(game.wordConnect.snapshot().slots);
  }, []);

  useGameEvent('wordConnect', sync);
  useGameEvent(
    'state',
    useCallback((payload: { state: string }) => {
      if (payload.state !== 'PLAYING' && payload.state !== 'PAUSED') setSlots([]);
    }, []),
  );

  return (
    <>
      {slots.map((slot) => (
        <LetterTile key={`${slot.index}-${slot.letter}`} slot={slot} />
      ))}
    </>
  );
}

/** Big enough to read across the room, small enough that four never collide. */
const SIZE = 1.5;
const HALO_SCALE = 1.5;

function LetterTile({ slot }: { slot: WordConnectSlot }) {
  const group = useRef<THREE.Group>(null);
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);

  const x = SLOT_X[slot.index];
  const y = SLOT_Y[slot.index];

  useFrame(() => {
    const node = group.current;
    if (!node) return;

    const t = game.time;
    // The live slot carries `usedAt`, which the snapshot copy does not track.
    const live = game.wordConnect.liveSlots.find((entry) => entry.index === slot.index);
    const spent = (live?.usedAt ?? null) !== null;
    const facing = game.input.slotIndex === slot.index;
    const wobble = slot.index * 1.7;

    const bob = Math.sin(t * 1.6 + wobble) * 0.16;
    const pulse = 1 + Math.sin(t * 3 + wobble) * 0.04 + game.beatPulse * 0.06;
    const aim = facing ? 1.22 : 1;

    node.position.set(x, y + bob, SLOT_Z + (facing ? 0.6 : 0));
    node.scale.setScalar(pulse * aim * (spent ? 0.78 : 1));
    node.rotation.z = Math.sin(t * 1.1 + wobble) * 0.05;

    // Connected letters go green and dim; the one you are facing lights up.
    const color = spent ? COLORS.correct : facing ? COLORS.warm : COLORS.accent;
    if (faceMat.current) faceMat.current.opacity = spent ? 0.45 : 1;
    if (ringMat.current) {
      ringMat.current.color.set(color);
      ringMat.current.opacity = spent ? 0.4 : facing ? 1 : 0.7;
    }
    if (glowMat.current) {
      glowMat.current.color.set(color);
      glowMat.current.opacity = spent ? 0.12 : facing ? 0.5 : 0.22;
    }
  });

  /** Clicking a letter is still a punch — and still has to agree with position. */
  const punch = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    game.input.punch({ laneIndex: slot.index, source: 'mouse', hand: 'right' });
  };

  return (
    <group ref={group} position={[x, y, SLOT_Z]}>
      {/* Halo. */}
      <mesh position={[0, 0, -0.2]} scale={HALO_SCALE} raycast={() => null}>
        <circleGeometry args={[SIZE / 2, 32]} />
        <meshBasicMaterial
          ref={glowMat}
          color={COLORS.accent}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Ring. */}
      <mesh raycast={() => null}>
        <ringGeometry args={[SIZE * 0.62, SIZE * 0.72, 48]} />
        <meshBasicMaterial
          ref={ringMat}
          color={COLORS.accent}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* Letter face — also the click collider. */}
      <mesh onPointerDown={punch}>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshBasicMaterial
          ref={faceMat}
          map={getLetterTexture(slot.letter, COLORS.accent)}
          transparent
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
