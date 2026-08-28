import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import {
  COLORS,
  LANE_COLORS,
  LANE_LABELS,
  LANE_X,
  PLAYER_HAND,
  READ_Z,
  TARGET_D,
  TARGET_H,
  TARGET_W,
} from '../../game/constants';
import { game } from '../../game/instance';
import type { TargetRuntime } from '../../game/types';
import { getAnswerTexture } from '../../utils/answerTexture';
import { clamp01, easeOutBack, easeOutCubic } from '../../utils/math';

interface Props {
  target: TargetRuntime;
}

/**
 * One incoming answer block.
 *
 * All motion is written straight to the Three.js objects inside `useFrame` from
 * the mutable `TargetRuntime` the simulation owns — this component re-renders
 * only when a new question spawns.
 */
export function AnswerTarget({ target }: Props) {
  const group = useRef<THREE.Group>(null);
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null);
  const outlineMat = useRef<THREE.MeshBasicMaterial>(null);
  const labelMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const hovered = useRef(false);

  const laneColor = LANE_COLORS[target.lane];
  const texture = useMemo(
    () => getAnswerTexture(LANE_LABELS[target.lane], target.label, laneColor),
    [target.lane, target.label, laneColor],
  );
  const revealColor = useMemo(() => new THREE.Color(COLORS.correct), []);
  const baseColor = useMemo(() => new THREE.Color(laneColor), [laneColor]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    const now = game.time;
    const age = now - target.stateTime;
    const wobble = target.lane * 1.37;

    let scale = 1;
    let opacity = 1;
    let zOffset = 0;
    let yOffset = 0;
    let roll = 0;
    let emissive = 1.15;

    switch (target.state) {
      case 'INCOMING': {
        const spawnAge = now - target.spawnedAt;
        scale = easeOutBack(clamp01(spawnAge / 0.32));
        const holding = now < target.holdUntil;
        // Hold still and steady while the player reads; drift once moving.
        yOffset = holding ? 0 : Math.sin(now * 1.7 + wobble) * 0.06;
        roll = holding ? 0 : Math.sin(now * 1.25 + wobble) * 0.03;
        // Brighten as the block closes on the strike plane.
        const nearness = clamp01(1 - Math.abs(target.z) / Math.abs(READ_Z));
        emissive = 0.85 + nearness * 1.15 + game.beatPulse * 0.2;
        // The block you are standing in front of — the one a punch would
        // actually answer — lights up. This is the feedback that makes the
        // move-then-punch rule readable before you commit.
        if (game.input.stance === target.lane) {
          scale *= 1.07;
          emissive += 1.6 + Math.sin(now * 8) * 0.35;
        }
        if (hovered.current) {
          scale *= 1.03;
          emissive += 0.6;
        }
        break;
      }
      case 'HIT': {
        const k = clamp01(age / 0.5);
        const e = easeOutCubic(k);
        scale = 1 + e * 0.75;
        opacity = 1 - k;
        // Blown back toward the player, but stopping short of filling the view.
        zOffset = e * 5.0;
        roll = e * 1.15;
        emissive = 3.2 * (1 - k * 0.6);
        break;
      }
      case 'REVEAL': {
        scale = 1 + Math.sin(now * 19) * 0.055;
        emissive = 2.4 + Math.sin(now * 19) * 0.9;
        break;
      }
      case 'FADE': {
        const k = clamp01(age / 0.38);
        scale = 1 - k * 0.75;
        opacity = 1 - k;
        emissive = 0.6;
        break;
      }
      case 'ESCAPED': {
        const k = clamp01(age / 0.3);
        scale = Math.max(0.001, 1 - k);
        opacity = 1 - k;
        emissive = 0.4;
        break;
      }
    }

    g.position.set(target.x, target.y + yOffset, target.z + zOffset);
    g.scale.setScalar(Math.max(0.001, scale));
    g.rotation.z = roll;
    g.rotation.y = Math.sin(now * 0.9 + wobble) * 0.05;

    const tint = target.state === 'REVEAL' ? revealColor : baseColor;
    if (bodyMat.current) {
      bodyMat.current.emissive.copy(tint);
      bodyMat.current.emissiveIntensity = emissive * 0.32;
      bodyMat.current.opacity = opacity;
    }
    if (outlineMat.current) {
      outlineMat.current.color.copy(tint);
      outlineMat.current.opacity = opacity * 0.75;
    }
    if (labelMat.current) labelMat.current.opacity = opacity;
    if (glowMat.current) {
      glowMat.current.color.copy(tint);
      glowMat.current.opacity = opacity * (0.08 + emissive * 0.045);
    }
  });

  /**
   * Clicking a block still throws a punch at it — but the game only counts it
   * if the player is standing in this lane, exactly like every other input.
   */
  const punch = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (target.state !== 'INCOMING') return;
    game.input.punch({
      laneIndex: target.lane,
      source: 'mouse',
      hand: PLAYER_HAND,
      direction: { x: Math.sign(LANE_X[target.lane]) * 0.35, y: 0, z: -1 },
      power: 1,
      confidence: 1,
    });
  };

  /** Hovering a block also sets the aim, so Space knows what to punch. */
  const enter = () => {
    hovered.current = true;
    game.input.setAimLane(target.lane);
  };

  const leave = () => {
    hovered.current = false;
    if (game.input.getAimLane() === target.lane) game.input.setAimLane(null);
  };

  return (
    <group ref={group} position={[target.x, target.y, target.z]}>
      {/* Soft halo behind the block. */}
      <mesh position={[0, 0, -0.35]} scale={[1.18, 1.4, 1]}>
        <planeGeometry args={[TARGET_W, TARGET_H]} />
        <meshBasicMaterial
          ref={glowMat}
          color={laneColor}
          transparent
          opacity={0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Outline shell: same box, inverted, scaled up a touch. */}
      <mesh scale={[1.045, 1.09, 1.02]}>
        <boxGeometry args={[TARGET_W, TARGET_H, TARGET_D]} />
        <meshBasicMaterial
          ref={outlineMat}
          color={laneColor}
          side={THREE.BackSide}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Body — also the click/punch collider. */}
      <mesh onPointerDown={punch} onPointerOver={enter} onPointerOut={leave}>
        <boxGeometry args={[TARGET_W, TARGET_H, TARGET_D]} />
        <meshStandardMaterial
          ref={bodyMat}
          color="#0b1220"
          emissive={laneColor}
          emissiveIntensity={0.3}
          metalness={0.35}
          roughness={0.4}
          transparent
        />
      </mesh>

      {/* Label face. */}
      <mesh position={[0, 0, TARGET_D / 2 + 0.012]} raycast={() => null}>
        <planeGeometry args={[TARGET_W, TARGET_H]} />
        <meshBasicMaterial ref={labelMat} map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
