import { useCallback, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, KART_BLOCK_SPEED, KART_DESPAWN_Z, TUNNEL_START_Z } from '../../game/constants';
import { game } from '../../game/instance';
import { useGameEvent } from '../../hooks/useGameEvent';
import { getTopicSignTexture } from '../../utils/answerTexture';

/** Signs down each wall, and how far apart they sit. */
const PAIRS = 5;
const SPACING = 32;
const END_Z = KART_DESPAWN_Z + 4;
const START_Z = TUNNEL_START_Z;
const SPAN = END_Z - START_Z;

/** Out by the tunnel walls, above the road, angled back toward the driver. */
const SIGN_X = 11.4;
const SIGN_Y = 6.4;
const SIGN_W = 6.8;
const SIGN_H = 1.54;
const SIGN_YAW = 0.46;

/**
 * The chase topic, repeated on gantry signs down both tunnel walls.
 *
 * The topic *is* the question of this mini game, and at speed the player is
 * looking at the road, not at a strip of HUD along the top of the screen. This
 * puts the answer to "what am I collecting again?" where their eyes already
 * are, and keeps putting it there — a new one sweeps past every second or so.
 *
 * Out at the walls and above the picture rows, so it never covers the thing the
 * player is trying to read.
 */
export function TopicSigns() {
  const [topic, setTopic] = useState('');
  const group = useRef<THREE.Group>(null);
  const signs = useRef<THREE.Mesh[]>([]);

  // The topic only changes when a chase begins, so this is the one thing here
  // that goes through React at all.
  useGameEvent(
    'kartChase',
    useCallback((payload: { type: string; topic: string }) => {
      if (payload.type === 'START') setTopic(payload.topic);
    }, []),
  );

  const texture = useMemo(
    () => (topic ? getTopicSignTexture(topic, COLORS.accent) : null),
    [topic],
  );

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    const rush = game.chaseRush;
    const shown = rush > 0.01 && texture !== null;
    if (node.visible !== shown) node.visible = shown;
    if (!shown) return;

    const dt = Math.min(delta, 0.05);
    // Signs travel with the road, so they read as fixed things being driven
    // past rather than as objects flying at the player.
    const speed = KART_BLOCK_SPEED * rush;

    for (const sign of signs.current) {
      if (!sign) continue;
      sign.position.z += speed * dt;
      if (sign.position.z > END_Z) sign.position.z -= SPAN;

      // Bright as it comes alongside, faded out at both ends of the tunnel so
      // none of them pop in or out.
      const depth = (END_Z - sign.position.z) / SPAN;
      const material = sign.material as THREE.MeshBasicMaterial;
      material.opacity = rush * Math.min(1, (1 - depth) * 2.6) * Math.min(1, depth * 9);
    }
  });

  if (!texture) return null;

  return (
    <group ref={group} visible={false}>
      {Array.from({ length: PAIRS * 2 }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const z = START_Z + Math.floor(i / 2) * SPACING;
        return (
          <mesh
            key={i}
            ref={(mesh) => {
              if (mesh) signs.current[i] = mesh;
            }}
            position={[SIGN_X * side, SIGN_Y, z]}
            rotation={[0, -side * SIGN_YAW, 0]}
            raycast={() => null}
          >
            <planeGeometry args={[SIGN_W, SIGN_H]} />
            <meshBasicMaterial
              map={texture}
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
