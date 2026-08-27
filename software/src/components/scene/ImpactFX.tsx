import { useCallback, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameEvent } from '../../hooks/useGameEvent';
import { clamp01 } from '../../utils/math';

const MAX_PARTICLES = 360;
const PER_BURST = 34;
const MAX_WAVES = 5;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
}

interface Wave {
  x: number;
  y: number;
  z: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

/**
 * Every punch impact: a burst of shards plus an expanding shockwave.
 *
 * Both use fixed-size pools that are allocated once — no object churn per
 * frame, and no React state involved in the animation at all.
 */
export function ImpactFX() {
  const shards = useRef<THREE.InstancedMesh>(null);
  const waveRefs = useRef<Array<THREE.Mesh | null>>([]);
  const flash = useRef<THREE.PointLight>(null);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
      })),
    [],
  );
  const waves = useMemo<Wave[]>(
    () =>
      Array.from({ length: MAX_WAVES }, () => ({
        x: 0,
        y: 0,
        z: 0,
        life: 0,
        maxLife: 0.5,
        color: new THREE.Color(),
      })),
    [],
  );

  const cursor = useRef(0);
  const waveCursor = useRef(0);
  const flashLife = useRef(0);
  const flashColor = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tint = useMemo(() => new THREE.Color(), []);

  const spawn = useCallback(
    (payload: { x: number; y: number; z: number; color: string; power: number }) => {
      const mesh = shards.current;
      tint.set(payload.color);

      const count = Math.round(PER_BURST * clamp01(payload.power / 2 + 0.5));
      for (let i = 0; i < count; i += 1) {
        const p = particles[cursor.current];
        cursor.current = (cursor.current + 1) % MAX_PARTICLES;

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = (5 + Math.random() * 14) * payload.power;

        p.x = payload.x + (Math.random() - 0.5) * 1.4;
        p.y = payload.y + (Math.random() - 0.5) * 1.0;
        p.z = payload.z;
        p.vx = Math.sin(phi) * Math.cos(theta) * speed;
        p.vy = Math.sin(phi) * Math.sin(theta) * speed + 2;
        // Bias the spray toward the player — it reads as "blown apart at you".
        p.vz = Math.abs(Math.cos(phi)) * speed * 0.7 + 3;
        p.maxLife = 0.55 + Math.random() * 0.45;
        p.life = p.maxLife;
        p.size = 0.1 + Math.random() * 0.24;

        if (mesh) mesh.setColorAt(cursor.current, tint);
      }
      if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;

      const wave = waves[waveCursor.current];
      waveCursor.current = (waveCursor.current + 1) % MAX_WAVES;
      wave.x = payload.x;
      wave.y = payload.y;
      wave.z = payload.z;
      wave.maxLife = 0.46;
      wave.life = wave.maxLife;
      wave.color.set(payload.color);

      flashColor.set(payload.color);
      flashLife.current = 0.22;
    },
    [particles, waves, tint, flashColor],
  );

  useGameEvent('impact', spawn);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const mesh = shards.current;

    if (mesh) {
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        const p = particles[i];
        if (p.life <= 0) {
          dummy.position.set(0, -999, 0);
          dummy.scale.setScalar(0);
        } else {
          p.life -= dt;
          p.vy -= 16 * dt; // gravity
          p.vx *= 1 - 2.2 * dt;
          p.vz *= 1 - 1.1 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;

          const k = clamp01(p.life / p.maxLife);
          dummy.position.set(p.x, p.y, p.z);
          dummy.scale.setScalar(p.size * k);
          dummy.rotation.set(p.x * 2, p.y * 2, p.z);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < MAX_WAVES; i += 1) {
      const wave = waves[i];
      const node = waveRefs.current[i];
      if (!node) continue;
      if (wave.life <= 0) {
        node.visible = false;
        continue;
      }
      wave.life -= dt;
      const k = 1 - clamp01(wave.life / wave.maxLife);
      node.visible = true;
      node.position.set(wave.x, wave.y, wave.z + k * 1.2);
      node.scale.setScalar(0.5 + k * 7.5);
      const material = node.material as THREE.MeshBasicMaterial;
      material.color.copy(wave.color);
      material.opacity = (1 - k) * 0.5;
    }

    if (flash.current) {
      flashLife.current = Math.max(0, flashLife.current - dt);
      flash.current.intensity = flashLife.current * 170;
      flash.current.color.copy(flashColor);
    }
  });

  return (
    <group>
      <instancedMesh
        ref={shards}
        args={[undefined, undefined, MAX_PARTICLES]}
        frustumCulled={false}
        raycast={() => null}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      {Array.from({ length: MAX_WAVES }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            waveRefs.current[i] = node;
          }}
          visible={false}
          raycast={() => null}
        >
          <ringGeometry args={[0.82, 1, 48]} />
          <meshBasicMaterial
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}

      <pointLight ref={flash} position={[0, 2, 1]} intensity={0} distance={40} decay={2} />
    </group>
  );
}
