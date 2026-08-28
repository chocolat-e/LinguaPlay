import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, MONSTER_Y, MONSTER_Z } from '../../game/constants';
import { game } from '../../game/instance';

/** Radial streaks around the monster. Enough to read as a ring, cheap to draw. */
const STREAKS = 30;
const RINGS = 3;
const FX_Z = MONSTER_Z + 4;

/**
 * The special attack, in the scene: energy dragged inward while the blow winds
 * up, then thrown outward when it lands.
 *
 * Driven entirely by `game.specialCharge` and `game.specialBlast`, which the
 * simulation already maintains — so this is one more reader of the frame
 * state, not a second animation system. Everything is pre-allocated and the
 * whole group hides itself when neither value is live, so it costs nothing
 * during normal play.
 */
export function SpecialFX() {
  const group = useRef<THREE.Group>(null);
  const streaks = useRef<THREE.InstancedMesh>(null);
  const streakMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.PointLight>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const warm = useMemo(() => new THREE.Color(COLORS.warm), []);
  const white = useMemo(() => new THREE.Color('#ffffff'), []);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const node = group.current;
    if (!node) return;

    const charge = game.specialCharge;
    const blast = game.specialBlast;
    const live = charge > 0.002 || blast > 0.002;
    node.visible = live;
    if (!live) return;

    const t = game.time;
    // White-hot at the moment of impact, warm while it is only building.
    tint.copy(warm).lerp(white, blast * 0.8);

    const mesh = streaks.current;
    if (mesh) {
      // Pulled in as the blow charges, hurled outward when it lands.
      const radius = 21 - charge * 12 + blast * 17;
      const length = 1.8 + charge * 2.6 + blast * 9;
      const spin = t * 0.6 + charge * 1.4;

      for (let i = 0; i < STREAKS; i += 1) {
        const angle = (i / STREAKS) * Math.PI * 2 + spin;
        // Staggering by index stops the ring reading as one rigid wheel.
        const jitter = 1 + Math.sin(i * 2.4 + t * 5) * 0.12;
        const r = radius * jitter;

        dummy.position.set(
          Math.cos(angle) * r,
          MONSTER_Y + Math.sin(angle) * r * 0.62,
          FX_Z,
        );
        dummy.rotation.set(0, 0, angle);
        dummy.scale.set(length * jitter, 0.1 + blast * 0.26, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (streakMat.current) {
      streakMat.current.color.copy(tint);
      streakMat.current.opacity = Math.min(1, charge * 0.45 + blast * 0.95);
    }

    for (let i = 0; i < RINGS; i += 1) {
      const ring = ringRefs.current[i];
      if (!ring) continue;
      // Each ring lags the one before it, so a blow reads as a shock front
      // rather than a single flat circle.
      const lag = i * 0.22;
      const push = Math.max(0, blast - lag);
      // Held short of flying off screen: a shock front you cannot see is not a
      // shock front.
      const scale = 1.6 + (1 - charge) * 5 + push * (13 + i * 6);
      ring.scale.setScalar(scale);
      ring.rotation.z = t * (0.4 + i * 0.25) * (i % 2 === 0 ? 1 : -1);
      const material = ring.material as THREE.MeshBasicMaterial;
      material.color.copy(tint);
      material.opacity = Math.min(1, charge * 0.3 + push * 0.9) * (1 - i * 0.2);
    }

    if (coreRef.current && coreMat.current) {
      // A hot core inside the monster: swells while charging, detonates on hit.
      coreRef.current.scale.setScalar(0.4 + charge * 3.4 + blast * 6);
      coreMat.current.color.copy(tint);
      // Deliberately short of opaque: the monster being hammered is the point,
      // so the blast must never white it out.
      coreMat.current.opacity = charge * 0.26 + blast * 0.34;
    }

    if (light.current) {
      light.current.color.copy(tint);
      light.current.intensity = charge * 110 + blast * 420;
    }
  });

  return (
    <group ref={group} visible={false} raycast={() => null}>
      <instancedMesh
        ref={streaks}
        args={[undefined, undefined, STREAKS]}
        frustumCulled={false}
        raycast={() => null}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={streakMat}
          color={COLORS.warm}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </instancedMesh>

      {Array.from({ length: RINGS }, (_, i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            ringRefs.current[i] = mesh;
          }}
          position={[0, MONSTER_Y, FX_Z]}
          raycast={() => null}
        >
          <ringGeometry args={[0.94, 1, 64]} />
          <meshBasicMaterial
            color={COLORS.warm}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}

      <mesh ref={coreRef} position={[0, MONSTER_Y, MONSTER_Z + 1]} raycast={() => null}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial
          ref={coreMat}
          color={COLORS.warm}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <pointLight
        ref={light}
        position={[0, MONSTER_Y, MONSTER_Z + 6]}
        intensity={0}
        distance={140}
        decay={2}
        color={COLORS.warm}
      />
    </group>
  );
}
