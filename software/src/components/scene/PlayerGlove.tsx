import { useCallback, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, PLAYER_HAND } from '../../game/constants';
import { game } from '../../game/instance';
import { useGameEvent } from '../../hooks/useGameEvent';
import { clamp01, easeOutCubic } from '../../utils/math';

const SIDE = PLAYER_HAND === 'right' ? 1 : -1;

/** Camera-local rest pose, framed for a 45° vertical FOV. */
const REST: [number, number, number] = [1.32 * SIDE, -1.3, -2.9];

/**
 * Where the fist swings for each lane, in camera-local units. Lanes are
 * A/B top row, C/D bottom row — so the glove visibly reaches up-left,
 * up-right, down-left or down-right, which doubles as feedback for *which*
 * answer the player just committed to.
 */
const LANE_AIM: Array<{ x: number; y: number }> = [
  { x: -1.55, y: 0.72 },
  { x: -0.15, y: 0.72 },
  { x: -1.55, y: 0.16 },
  { x: -0.15, y: 0.16 },
];

/**
 * The player's single fist, parented to the camera so it inherits screen shake.
 *
 * This is a one-handed game: one glove throws every punch, reaching toward
 * whichever lane was hit rather than splitting duties between two hands.
 */
export function PlayerGlove() {
  const glove = useRef<THREE.Group>(null);
  /** 0 → punch just started, 1 → fully recovered. */
  const lunge = useRef(1);
  const aim = useRef({ x: 0, y: 0 });

  const onPunch = useCallback((payload: { lane: number | null }) => {
    const target = payload.lane === null ? { x: -0.85, y: 0.44 } : LANE_AIM[payload.lane];
    aim.current.x = target.x * SIDE;
    aim.current.y = target.y;
    lunge.current = 0;
  }, []);
  useGameEvent('punch', onPunch);

  useFrame((_, delta) => {
    const node = glove.current;
    if (!node) return;

    const dt = Math.min(delta, 0.05);
    const t = game.time;

    lunge.current = Math.min(1, lunge.current + dt * 4.2);
    const k = lunge.current;
    // Snap out fast, drift back slow.
    const extend = k < 0.28 ? easeOutCubic(k / 0.28) : 1 - (k - 0.28) / 0.72;
    const push = Math.sin(clamp01(extend) * Math.PI * 0.5);

    const [bx, by, bz] = REST;
    const bob = Math.sin(t * 2.1) * 0.035 + game.beatPulse * 0.05;

    node.position.set(
      bx + aim.current.x * push,
      by + bob + aim.current.y * push,
      bz - push * 1.5,
    );
    node.rotation.set(
      -0.35 - push * 0.45,
      -0.4 * SIDE + aim.current.x * push * 0.22,
      -0.2 * SIDE,
    );
    node.scale.setScalar(1 + push * 0.08);

    const trail = node.children[1] as THREE.Mesh | undefined;
    if (trail) {
      const material = trail.material as THREE.MeshBasicMaterial;
      material.opacity = push * 0.28;
      // The cylinder is rotated onto Z, so its length lives on local Y.
      trail.scale.set(1, 0.35 + push * 0.8, 1);
    }
  });

  const fist = useMemo(() => new THREE.SphereGeometry(0.38, 20, 16), []);
  const cuff = useMemo(() => new THREE.CylinderGeometry(0.24, 0.29, 0.4, 18), []);
  const color = COLORS.accent;

  return (
    <group ref={glove} position={REST} rotation={[-0.35, -0.4 * SIDE, 0]}>
      <group>
        {/* Fist */}
        <mesh geometry={fist} scale={[1, 0.92, 1.12]}>
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.85}
            metalness={0.25}
            roughness={0.45}
            toneMapped={false}
          />
        </mesh>
        {/* Knuckle plate */}
        <mesh position={[0, 0.06, -0.4]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[0.6, 0.24, 0.12]} />
          <meshStandardMaterial
            color="#0a1220"
            emissive={color}
            emissiveIntensity={1.5}
            toneMapped={false}
          />
        </mesh>
        {/* Wrist cuff */}
        <mesh geometry={cuff} position={[0, -0.1, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial
            color="#18243c"
            emissive={color}
            emissiveIntensity={0.25}
            metalness={0.5}
            roughness={0.4}
          />
        </mesh>
      </group>

      {/* Motion trail, stretched along the punch axis. */}
      <mesh position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.05, 0.34, 1.1, 14, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
