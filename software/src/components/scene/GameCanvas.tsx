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
import { KartBlocks } from './KartBlocks';
import { KartCockpit } from './KartCockpit';
import { Monster } from './Monster';
import { NeonTunnel } from './NeonTunnel';
import { PlayerGlove } from './PlayerGlove';
import { SpecialFX } from './SpecialFX';
import { SpeedStreaks } from './SpeedStreaks';
import { TopicSigns } from './TopicSigns';
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
  /** Previous body position and the smoothed steering rate derived from it. */
  const lastX = useRef(0);
  const steerRate = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) || 1 / 60;
    const amount = game.settings.screenShake ? game.shake : 0;
    const t = game.time;
    const sway = Math.sin(t * 0.35) * 0.06;
    const x = game.input.motion.x;
    const charge = game.specialCharge;
    const blast = game.specialBlast;

    // Chase feel. `rush` ramps in and out with the chase; the other three are
    // one-off spikes the simulation sets when something happens.
    const rush = game.chaseRush;
    const lurch = game.chaseLurch;
    const slam = game.chaseSlam;

    // How fast the player is crossing lanes, smoothed. A kart leans into a
    // change of lane and rights itself again — that lean is the single biggest
    // thing that separates driving from strafing.
    const rate = (x - lastX.current) / dt;
    lastX.current = x;
    steerRate.current += (rate - steerRate.current) * Math.min(1, dt * 12);
    const bank = Math.max(-1, Math.min(1, steerRate.current / 5));

    // The lane offset opens up at speed, so a lane change covers real ground.
    const lateral = x * PLAYER_LANE_WORLD_X * (1 + rush * 0.85);
    // Engine rumble: fast, small, and only while moving.
    const rumble = Math.sin(t * 34) * rush * 0.035;

    camera.position.set(
      CAMERA_POS[0] +
        lateral +
        sway +
        // A crash throws the kart off its line before it recovers.
        Math.sin(t * 46) * slam * 0.5 +
        (Math.random() - 0.5) * amount * 0.55,
      // Sitting in a kart is lower than standing in a ring.
      CAMERA_POS[1] -
        rush * 0.8 +
        Math.sin(t * 0.5) * 0.04 +
        rumble +
        (Math.random() - 0.5) * amount * 0.5,
      // Drift back as a blow charges, lunge in with it; lean into the road
      // while driving, surge on every picture banked, recoil on every crash.
      CAMERA_POS[2] +
        charge * 1.6 -
        blast * 2.2 -
        rush * 0.9 -
        lurch * 1.4 +
        slam * 1.1 +
        (Math.random() - 0.5) * amount * 0.3,
    );

    camera.rotation.z =
      (Math.random() - 0.5) * amount * 0.06 +
      Math.sin(t * 0.3) * 0.005 -
      x * 0.02 -
      blast * 0.05 -
      // The bank itself, plus a shudder that throws it sideways on a crash.
      bank * rush * 0.16 -
      bank * 0.03 +
      Math.sin(t * 38) * slam * 0.05;
    // Nose down over the road at speed, and snapped up by an impact.
    camera.rotation.x = -rush * 0.035 + slam * 0.05;

    // A wider lens on impact: the classic punch-in that makes a hit feel big.
    // Speed widens it too — the edges of the frame stretch and the road pours
    // past faster than the middle, which is what reads as velocity.
    const next = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
      ? CAMERA_FOV - charge * 3 + blast * 7 + rush * 7 + lurch * 6 + slam * 4
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
        <KartCockpit />
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
      <KartBlocks />
      <TopicSigns />
      <SpeedStreaks />
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
