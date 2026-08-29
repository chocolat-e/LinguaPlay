import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  COLORS,
  KART_FLEE_DISTANCE,
  KART_FLEE_WEAVE,
  MONSTER_CHARGE_SECONDS,
  MONSTER_STRIKE_SECONDS,
  MONSTER_Y,
  MONSTER_Z,
} from '../../game/constants';
import { game } from '../../game/instance';
import { clamp01, easeOutCubic } from '../../utils/math';

/**
 * The opponent, floating down the tunnel behind the answer blocks.
 *
 * Like every other object in the scene it reads the simulation inside
 * `useFrame` and writes straight to Three.js transforms — the component never
 * re-renders during a fight. `MonsterManager` owns the phase; everything here
 * is how that phase looks.
 */
export function Monster() {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const shellMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);

  /** One material shared by both eyes, so a single tint drives the pair. */
  const eyeMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffd7ff', transparent: true, toneMapped: false }),
    [],
  );

  const idleColor = useMemo(() => new THREE.Color(COLORS.monster), []);
  const angryColor = useMemo(() => new THREE.Color(COLORS.wrong), []);
  const hurtColor = useMemo(() => new THREE.Color('#ffffff'), []);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const node = group.current;
    if (!node) return;

    const monster = game.monster;
    const t = game.time;
    const age = t - monster.phaseTime;

    // Rest pose: a slow breathing drift, nudged by the music.
    let scale = 1 + Math.sin(t * 1.1) * 0.03 + game.beatPulse * 0.05;
    let x = 0;
    let z = MONSTER_Z + Math.sin(t * 0.5) * 0.6;
    let y = MONSTER_Y + Math.sin(t * 0.8) * 0.3;
    let anger = 0;
    let flash = 0;
    let spin = 0.35;
    let opacity = 1;

    switch (monster.phase) {
      case 'HURT': {
        // Snap back, flash white, and settle — the recoil sells the hit.
        const k = clamp01(age / 0.45);
        flash = 1 - k;
        scale *= 1 + (1 - k) * 0.16;
        z -= (1 - k) * 3.4;
        y += Math.sin(age * 46) * (1 - k) * 0.5;
        spin = 0.35 + (1 - k) * 3;
        break;
      }
      case 'CHARGING': {
        // Wind-up: pull back, swell, redden, and shudder faster as it nears
        // release — the shudder *is* the read on when to raise the guard.
        const progress = clamp01(
          1 - monster.chargeRemaining / Math.max(0.001, MONSTER_CHARGE_SECONDS),
        );
        anger = progress;
        scale *= 1 + progress * 0.34;
        z -= progress * 4.5;
        y += Math.sin(t * (7 + progress * 26)) * (0.16 + progress * 0.42);
        spin = 0.35 + progress * 4.5;
        break;
      }
      case 'STRIKING': {
        // Lunge at the camera, then fall back.
        const k = clamp01(age / MONSTER_STRIKE_SECONDS);
        const lunge = k < 0.3 ? easeOutCubic(k / 0.3) : 1 - (k - 0.3) / 0.7;
        anger = 1;
        z += lunge * (Math.abs(MONSTER_Z) - 4);
        scale *= 1 + lunge * 0.25;
        spin = 5;
        break;
      }
      case 'DEFEATED': {
        const k = clamp01(age / 1.4);
        opacity = 1 - k * 0.85;
        scale *= 1 - k * 0.45;
        y -= k * 4.5;
        spin = 0.35 + k * 2.5;
        break;
      }
      default:
        break;
    }

    // The special attack rides on top of whatever phase the monster is in: it
    // is braced and dragged forward while the blow charges, then hammered
    // backwards down the tunnel as each one lands.
    const charge = game.specialCharge;
    const blast = game.specialBlast;
    if (charge > 0.002) {
      scale *= 1 - charge * 0.14;
      z += charge * 2.2;
      y += Math.sin(t * 40) * charge * 0.35;
      anger = Math.max(anger, charge * 0.7);
      spin += charge * 6;
    }
    if (blast > 0.002) {
      scale *= 1 + blast * 0.3;
      z -= blast * 9;
      y += Math.sin(t * 60) * blast * 1.1;
      flash = Math.max(flash, blast * 0.8);
      spin += blast * 14;
    }

    // Running for it. This is the chase made visible: `chaseGap` is 1 while the
    // monster is away down the tunnel and 0 once the kart is alongside, so the
    // same number that throws it into the distance when the chase opens hauls
    // it back in, one lurch at a time, with every picture banked.
    const flee = game.chaseRush;
    if (flee > 0.002) {
      const gap = game.chaseGap;
      z -= gap * KART_FLEE_DISTANCE * flee;
      // It swerves across the road as it runs, and the swerve dies out as the
      // kart closes — a cornered thing stops being able to shake you off.
      x += Math.sin(t * 2.3) * KART_FLEE_WEAVE * gap * flee;
      // Lifted while it is still away down the road, so it stays in sight over
      // the rows of pictures instead of hiding behind them.
      y += gap * flee * 2.6 + Math.sin(t * 3.1) * 0.9 * gap * flee;
      // Shrinking faster than perspective alone would, so it really reads as
      // getting away rather than merely being far off.
      scale *= 1 - gap * 0.3 * flee;
      spin += flee * (2 + gap * 5);
      // Panic rises as the kart gets close enough to ram it.
      anger = Math.max(anger, flee * (1 - gap) * 0.85);
      // And it flinches every time ground is made up on it.
      flash = Math.max(flash, game.chaseLurch * 0.55);
    }

    node.position.set(x, y, z);
    node.scale.setScalar(Math.max(0.001, scale));

    // Colour carries the state: violet at rest, red winding up, white on hit.
    tint.copy(idleColor).lerp(angryColor, anger).lerp(hurtColor, flash);

    if (coreMat.current) {
      coreMat.current.emissive.copy(tint);
      coreMat.current.emissiveIntensity = 0.7 + anger * 1.5 + flash * 3.5;
      coreMat.current.opacity = opacity;
    }
    if (shellMat.current) {
      shellMat.current.color.copy(tint);
      shellMat.current.opacity = opacity * (0.16 + anger * 0.3 + flash * 0.4);
    }
    eyeMaterial.color.copy(tint).lerp(hurtColor, 0.45);
    eyeMaterial.opacity = opacity;
    if (core.current) {
      core.current.rotation.y = t * spin * 0.4;
      core.current.rotation.x = Math.sin(t * 0.7) * 0.18;
    }
    if (ringA.current) {
      ringA.current.rotation.z = t * spin;
      ringA.current.rotation.x = Math.PI / 2.6 + Math.sin(t * 0.6) * 0.2;
      (ringA.current.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
    }
    if (ringB.current) {
      ringB.current.rotation.z = -t * spin * 0.75;
      ringB.current.rotation.y = Math.PI / 3 + Math.cos(t * 0.5) * 0.25;
      (ringB.current.material as THREE.MeshBasicMaterial).opacity = opacity * 0.45;
    }
    if (eyes.current) {
      // The eyes narrow as it winds up.
      eyes.current.scale.set(1, Math.max(0.12, 1 - anger * 0.75), 1);
    }
    if (glow.current) {
      glow.current.color.copy(tint);
      glow.current.intensity = (55 + anger * 190 + flash * 320) * opacity;
    }
  });

  const coreGeometry = useMemo(() => new THREE.IcosahedronGeometry(3.2, 0), []);
  const eyeGeometry = useMemo(() => new THREE.SphereGeometry(0.42, 16, 12), []);

  return (
    <group ref={group} position={[0, MONSTER_Y, MONSTER_Z]} raycast={() => null}>
      {/* Glowing halo shell. */}
      <mesh scale={1.42} raycast={() => null}>
        <icosahedronGeometry args={[3.2, 1]} />
        <meshBasicMaterial
          ref={shellMat}
          color={COLORS.monster}
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>

      {/* Faceted body. */}
      <mesh ref={core} geometry={coreGeometry} raycast={() => null}>
        <meshStandardMaterial
          ref={coreMat}
          color="#160b2c"
          emissive={COLORS.monster}
          emissiveIntensity={0.8}
          flatShading
          metalness={0.45}
          roughness={0.35}
          transparent
        />
      </mesh>

      {/* Orbiting rings — cheap, and they read as menace at any distance. */}
      <mesh ref={ringA} raycast={() => null}>
        <torusGeometry args={[5.1, 0.11, 8, 64]} />
        <meshBasicMaterial
          color={COLORS.monster}
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ringB} raycast={() => null}>
        <torusGeometry args={[6.4, 0.07, 8, 64]} />
        <meshBasicMaterial
          color={COLORS.accentSoft}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Eyes. */}
      <group ref={eyes} position={[0, 0.5, 3.0]}>
        <mesh
          geometry={eyeGeometry}
          material={eyeMaterial}
          position={[-1.05, 0, 0]}
          raycast={() => null}
        />
        <mesh
          geometry={eyeGeometry}
          material={eyeMaterial}
          position={[1.05, 0, 0]}
          raycast={() => null}
        />
      </group>

      <pointLight ref={glow} intensity={55} distance={70} decay={2} color={COLORS.monster} />
    </group>
  );
}
