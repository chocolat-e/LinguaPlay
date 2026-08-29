import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../../game/constants';
import { game } from '../../game/instance';

/**
 * The kart the player is sitting in: a wheel they are turning and a nose ahead
 * of it, parented to the camera so both ride the shake.
 *
 * Everything else in the chase describes speed — the road, the streaks, the
 * lens. This is the part that says *you are driving*, and it is the one cue the
 * other two mini games have no equivalent of. It slides up into frame as the
 * chase winds on and drops back out when it ends, so it never has to be
 * mounted or unmounted.
 */
/**
 * Resting height of the wheel in camera-local units.
 *
 * At the chase's widened field of view the frame reaches to about y = -1.2 at
 * the wheel's depth, so a 0.92 rim centred here puts its top arc across the
 * bottom fifth of the screen and nothing more. A cockpit that eats the view is
 * worse than no cockpit at all.
 */
const WHEEL_Y = -1.62;

export function KartCockpit() {
  const rig = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Group>(null);
  /** Smoothed steering, so the wheel has weight instead of snapping. */
  const turn = useRef(0);

  const rimGeometry = useMemo(() => new THREE.TorusGeometry(0.92, 0.075, 10, 40), []);
  const spokeGeometry = useMemo(() => new THREE.BoxGeometry(1.5, 0.11, 0.09), []);
  const hubGeometry = useMemo(() => new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16), []);

  useFrame((_, delta) => {
    const node = rig.current;
    const hoop = wheel.current;
    if (!node || !hoop) return;

    const rush = game.chaseRush;
    const shown = rush > 0.01;
    if (node.visible !== shown) node.visible = shown;
    if (!shown) return;

    const dt = Math.min(delta, 0.05);
    // Out of frame at rest, fully up at speed.
    node.position.y = -1.5 * (1 - rush);

    const target = game.input.motion.x;
    turn.current += (target - turn.current) * Math.min(1, dt * 9);
    // A real wheel turns much further than the kart does.
    hoop.rotation.z = -turn.current * 1.15;
    // Jolted out of true by a crash, and shivering with the engine.
    hoop.rotation.z += Math.sin(game.time * 41) * game.chaseSlam * 0.22;
    // Offset from the resting height, never replacing it — the wheel belongs at
    // the bottom of the frame, and only its top arc should ever be in shot.
    hoop.position.y = WHEEL_Y + Math.sin(game.time * 30) * rush * 0.012;
  });

  return (
    <group ref={rig} visible={false} raycast={() => null}>
      {/* Steering wheel. */}
      <group ref={wheel} position={[0, WHEEL_Y, -2.3]}>
        <mesh geometry={rimGeometry} raycast={() => null}>
          <meshStandardMaterial
            color="#0e1830"
            emissive={COLORS.accent}
            emissiveIntensity={0.7}
            metalness={0.5}
            roughness={0.35}
            toneMapped={false}
          />
        </mesh>
        <mesh geometry={spokeGeometry} raycast={() => null}>
          <meshStandardMaterial
            color="#0e1830"
            emissive={COLORS.accentDeep}
            emissiveIntensity={0.9}
            toneMapped={false}
          />
        </mesh>
        <mesh
          geometry={spokeGeometry}
          rotation={[0, 0, Math.PI / 2]}
          scale={[0.62, 1, 1]}
          position={[0, -0.28, 0]}
          raycast={() => null}
        >
          <meshStandardMaterial
            color="#0e1830"
            emissive={COLORS.accentDeep}
            emissiveIntensity={0.9}
            toneMapped={false}
          />
        </mesh>
        <mesh geometry={hubGeometry} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <meshStandardMaterial
            color="#101c36"
            emissive={COLORS.warm}
            emissiveIntensity={0.8}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Nose of the kart, out ahead of the wheel. Unlit on purpose: the scene's
          key lights sit above the road, and a lit top face turned this into a
          pale ramp across the bottom of the screen. A flat dark silhouette with
          a neon edge is both truer to the art and far less in the way. */}
      <mesh position={[0, -2.05, -3.4]} rotation={[-0.22, 0, 0]} raycast={() => null}>
        <boxGeometry args={[2.8, 0.9, 2.1]} />
        <meshBasicMaterial color="#070d1a" toneMapped={false} />
      </mesh>
      {/* A lit strip along the nose, so it reads against a dark road. */}
      <mesh position={[0, -1.57, -3.02]} rotation={[-0.22, 0, 0]} raycast={() => null}>
        <planeGeometry args={[2.35, 0.09]} />
        <meshBasicMaterial
          color={COLORS.accent}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
