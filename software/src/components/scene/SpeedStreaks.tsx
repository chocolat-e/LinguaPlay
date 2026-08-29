import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, KART_DESPAWN_Z, TUNNEL_START_Z } from '../../game/constants';
import { game } from '../../game/instance';

const COUNT = 150;
/** Where a streak is reborn, and where it dies. */
const START_Z = TUNNEL_START_Z;
const END_Z = KART_DESPAWN_Z + 8;
const SPAN = END_Z - START_Z;

/**
 * Streaks of air tearing past the kart.
 *
 * Lines drawn *along* the depth axis, so from the cockpit they radiate out of
 * the vanishing point — the oldest and cheapest way to draw speed, and the one
 * thing the tunnel grid cannot do on its own because a grid only scrolls.
 *
 * They are seeded in a ring around the tunnel axis with a hole in the middle,
 * so they frame the road and never scribble over the pictures the player is
 * trying to read. Invisible — and not drawn at all — outside a chase.
 */
export function SpeedStreaks() {
  const lines = useRef<THREE.LineSegments>(null);

  /** x, y and the current z of each streak. Two vertices per streak. */
  const { geometry, seeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 6);
    const seeds = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i += 1) {
      seed(seeds, i, START_Z + Math.random() * SPAN);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // The streaks move every frame and cover the whole tunnel; culling them
    // against a bounding box that would have to be rebuilt constantly is worse
    // than never culling one object.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, -60), 200);
    return { geometry, seeds };
  }, []);

  useFrame((_, delta) => {
    const node = lines.current;
    if (!node) return;

    const rush = game.chaseRush;
    const shown = rush > 0.01;
    if (node.visible !== shown) node.visible = shown;
    if (!shown) return;

    const dt = Math.min(delta, 0.05);
    const material = node.material as THREE.LineBasicMaterial;
    material.opacity = rush * rush * 0.8;

    // Far faster than the picture rows themselves. The point of a streak is
    // that it is the air, not the traffic.
    const speed = 48 + rush * 100;
    // ...and it stretches with speed, which is what turns dots into lines.
    const length = 3 + rush * 12;

    const attribute = geometry.attributes.position as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;

    for (let i = 0; i < COUNT; i += 1) {
      let z = seeds[i * 3 + 2] + speed * dt;
      if (z > END_Z) {
        seed(seeds, i, START_Z);
        z = seeds[i * 3 + 2];
      } else {
        seeds[i * 3 + 2] = z;
      }

      const x = seeds[i * 3];
      const y = seeds[i * 3 + 1];
      const o = i * 6;
      array[o] = x;
      array[o + 1] = y;
      array[o + 2] = z;
      array[o + 3] = x;
      array[o + 4] = y;
      // The tail trails behind, down the tunnel.
      array[o + 5] = z - length;
    }
    attribute.needsUpdate = true;
  });

  return (
    <lineSegments ref={lines} geometry={geometry} visible={false} raycast={() => null}>
      <lineBasicMaterial
        color={COLORS.accentSoft}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

/**
 * Places one streak in a ring around the tunnel axis.
 *
 * The inner radius is what keeps the middle of the frame clear: the picture
 * rows sit within about five units of the axis, so nothing is seeded inside
 * seven.
 */
function seed(seeds: Float32Array, i: number, z: number): void {
  const angle = Math.random() * Math.PI * 2;
  const radius = 7 + Math.random() * 8;
  seeds[i * 3] = Math.cos(angle) * radius;
  seeds[i * 3 + 1] = 5 + Math.sin(angle) * radius * 0.62;
  seeds[i * 3 + 2] = z;
}
