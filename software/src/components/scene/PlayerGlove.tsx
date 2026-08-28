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
 * Where the fist swings for each lane, in camera-local units. The camera has
 * already slid to the player's position, so these are small corrections rather
 * than full reaches — the glove nudges toward the block it is answering.
 */
const LANE_AIM: Array<{ x: number; y: number }> = [
  { x: -1.1, y: 0.5 },
  { x: -0.7, y: 0.55 },
  { x: -0.3, y: 0.5 },
];

/** Camera-local guard pose: fist up in front of the face. */
const GUARD: { x: number; y: number; z: number } = { x: -0.75, y: 0.95, z: -0.55 };

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
  /** 0 → hands down, 1 → guard fully raised. */
  const guard = useRef(0);
  const aim = useRef({ x: 0, y: 0 });

  const onPunch = useCallback((payload: { lane: number | null }) => {
    // A punch with no lane — a whiff, or a word-connect letter — reaches
    // wherever the player is aiming instead.
    const motion = game.input.motion;
    const reaching = motion.mode === 'REACH';
    const ax = reaching ? motion.handX : motion.x;
    const ay = reaching ? motion.handY : 0;
    const target =
      payload.lane === null
        ? { x: -0.85 + ax * 0.5, y: 0.44 + ay * 0.5 }
        : LANE_AIM[payload.lane] ?? { x: -0.7, y: 0.5 };
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

    // The guard is a pose, not an animation: while it is up the fist sits
    // high in front of the face, which is the player's read that they are
    // actually protected right now.
    const guardTarget = game.input.isGuarding() ? 1 : 0;
    guard.current += (guardTarget - guard.current) * Math.min(1, dt * 18);
    const g = guard.current;

    // During Word Connect the arm *is* the aim, so the fist tracks the reach
    // continuously — the player can see which letter they are pointing at
    // before they commit to the punch.
    const motion = game.input.motion;
    const reaching = motion.mode === 'REACH';
    const reachX = reaching ? motion.handX * 0.85 : 0;
    const reachY = reaching ? motion.handY * 0.7 : 0;

    const [bx, by, bz] = REST;
    const bob = Math.sin(t * 2.1) * 0.035 + game.beatPulse * 0.05;
    const shiver = g * Math.sin(t * 26) * 0.012;

    node.position.set(
      bx + reachX + aim.current.x * push + (GUARD.x - bx) * g,
      by + bob + reachY + aim.current.y * push + (GUARD.y - by) * g + shiver,
      bz - push * 1.5 + (GUARD.z - bz) * g,
    );
    node.rotation.set(
      -0.35 - push * 0.45 + g * 0.55 - reachY * 0.3,
      -0.4 * SIDE + aim.current.x * push * 0.22 + reachX * 0.25,
      -0.2 * SIDE - g * 0.5 * SIDE,
    );
    node.scale.setScalar(1 + push * 0.08 + g * 0.06);

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
