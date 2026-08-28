import { useCallback, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import {
  CAMERA_FOV,
  CAMERA_POS,
  COLORS,
  PLAYER_LANE_WORLD_X,
} from '../../game/constants';
import { game } from '../../game/instance';
import type { TargetRuntime } from '../../game/types';
import { useGameEvent } from '../../hooks/useGameEvent';
import { AnswerTarget } from './AnswerTarget';
import { ImpactFX } from './ImpactFX';
import { Monster } from './Monster';
import { NeonTunnel } from './NeonTunnel';
import { PlayerGlove } from './PlayerGlove';
import { SpecialFX } from './SpecialFX';
import { WordLetters } from './WordLetters';

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

/**
 * Camera rig: the player's lateral position, plus decaying positional + roll
 * shake, on top of the camera's rest pose.
 *
 * Moving the viewpoint is what makes standing LEFT / CENTER / RIGHT legible —
 * the world slides as you walk, so the answer you are in front of is obvious
 * before you ever throw the punch.
 */
function CameraRig() {
  const camera = useThree((state) => state.camera);
  /** Last FOV written, so the projection matrix is only rebuilt when it moves. */
  const fov = useRef(CAMERA_FOV);

  useFrame(() => {
    const amount = game.settings.screenShake ? game.shake : 0;
    const t = game.time;
    const sway = Math.sin(t * 0.35) * 0.06;
    const lateral = game.input.motion.x * PLAYER_LANE_WORLD_X;
    const charge = game.specialCharge;
    const blast = game.specialBlast;

    camera.position.set(
      CAMERA_POS[0] + lateral + sway + (Math.random() - 0.5) * amount * 0.55,
      CAMERA_POS[1] + Math.sin(t * 0.5) * 0.04 + (Math.random() - 0.5) * amount * 0.5,
      // Drift back as the blow charges, then lunge in with it.
      CAMERA_POS[2] + charge * 1.6 - blast * 2.2 + (Math.random() - 0.5) * amount * 0.3,
    );
    // A slight lean into the direction of travel, and a hard roll on impact.
    camera.rotation.z =
      (Math.random() - 0.5) * amount * 0.06 +
      Math.sin(t * 0.3) * 0.005 -
      game.input.motion.x * 0.02 -
      blast * 0.05;

    // A wider lens on impact: the classic punch-in that makes a hit feel big.
    const next = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
      ? CAMERA_FOV - charge * 3 + blast * 7
      : CAMERA_FOV;
    if (Math.abs(next - fov.current) > 0.01) {
      fov.current = next;
      (camera as THREE.PerspectiveCamera).fov = next;
      camera.updateProjectionMatrix();
    }
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
      <CameraRig />

      <ambientLight intensity={0.6} color="#93b4d8" />
      <hemisphereLight args={['#5b7fb5', '#0d1424', 0.5]} />
      <directionalLight position={[4, 10, 8]} intensity={1.15} color="#ffffff" />
      <pointLight position={[-9, 5, 5]} intensity={55} distance={44} color={COLORS.accent} />
      <pointLight position={[9, 5, 5]} intensity={55} distance={44} color={COLORS.accentSoft} />

      <NeonTunnel />
      <Monster />
      <TargetField />
      <WordLetters />
      <SpecialFX />
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
