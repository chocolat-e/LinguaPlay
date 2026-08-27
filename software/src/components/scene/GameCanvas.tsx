import { useCallback, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { CAMERA_FOV, CAMERA_POS, COLORS } from '../../game/constants';
import { game } from '../../game/instance';
import type { TargetRuntime } from '../../game/types';
import { useGameEvent } from '../../hooks/useGameEvent';
import { AnswerTarget } from './AnswerTarget';
import { ImpactFX } from './ImpactFX';
import { NeonTunnel } from './NeonTunnel';
import { PlayerGlove } from './PlayerGlove';

/**
 * Single driver for the whole simulation.
 *
 * Priority -1 puts it ahead of every other `useFrame`, so the scene always
 * animates against a clock that has already advanced this frame.
 */
function GameLoop() {
  useFrame((_, delta) => game.tick(delta), -1);
  return null;
}

/** Applies decaying positional + roll shake on top of the camera's rest pose. */
function CameraShake() {
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const amount = game.settings.screenShake ? game.shake : 0;
    const t = game.time;
    const sway = Math.sin(t * 0.35) * 0.06;

    camera.position.set(
      CAMERA_POS[0] + sway + (Math.random() - 0.5) * amount * 0.55,
      CAMERA_POS[1] + Math.sin(t * 0.5) * 0.04 + (Math.random() - 0.5) * amount * 0.5,
      CAMERA_POS[2] + (Math.random() - 0.5) * amount * 0.3,
    );
    camera.rotation.z = (Math.random() - 0.5) * amount * 0.06 + Math.sin(t * 0.3) * 0.005;
  });

  return null;
}

/** Mirrors the live target list into the scene graph, once per question. */
function TargetField() {
  // Seed from whatever is already live, so a late mount (hot reload, or a
  // canvas that initialised after the round began) still shows the round.
  const [targets, setTargets] = useState<TargetRuntime[]>(() => [...game.targets]);

  useGameEvent(
    'question',
    useCallback((payload: { targets: TargetRuntime[] }) => {
      setTargets([...payload.targets]);
    }, []),
  );

  useGameEvent(
    'state',
    useCallback((payload: { state: string }) => {
      if (payload.state !== 'PLAYING' && payload.state !== 'PAUSED') setTargets([]);
    }, []),
  );

  return (
    <>
      {targets.map((target) => (
        <AnswerTarget key={target.id} target={target} />
      ))}
    </>
  );
}

export function GameCanvas() {
  /** A click that hits nothing is still a punch — it just whiffs. */
  const onMissed = useCallback(() => {
    game.input.punch({ laneIndex: null, source: 'mouse', hand: 'right' });
  }, []);

  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene, camera }) => {
        if (import.meta.env.DEV) {
          // Dev handle for inspecting the render graph from the console.
          (window as unknown as Record<string, unknown>).three = { gl, scene, camera };
        }
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        scene.fog = new THREE.Fog('#070b14', 48, 150);
      }}
      onPointerMissed={onMissed}
    >
      <color attach="background" args={['#070b14']} />

      <PerspectiveCamera makeDefault fov={CAMERA_FOV} near={0.1} far={280} position={CAMERA_POS}>
        <PlayerGlove />
      </PerspectiveCamera>

      <GameLoop />
      <CameraShake />

      <ambientLight intensity={0.6} color="#93b4d8" />
      <hemisphereLight args={['#5b7fb5', '#0d1424', 0.5]} />
      <directionalLight position={[4, 10, 8]} intensity={1.15} color="#ffffff" />
      <pointLight position={[-9, 5, 5]} intensity={55} distance={44} color={COLORS.accent} />
      <pointLight position={[9, 5, 5]} intensity={55} distance={44} color={COLORS.accentSoft} />

      <NeonTunnel />
      <TargetField />
      <ImpactFX />

      <EffectComposer>
        <Bloom
          intensity={0.5}
          luminanceThreshold={0.42}
          luminanceSmoothing={0.4}
          mipmapBlur
          radius={0.62}
        />
        <Vignette offset={0.28} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
