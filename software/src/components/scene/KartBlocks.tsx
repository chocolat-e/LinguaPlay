import { useCallback, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  COLORS,
  KART_BLOCK_SIZE,
  KART_BLOCK_Y,
  KART_DESPAWN_Z,
  KART_LANE_X,
  KART_LANE_Y,
  KART_SPAWN_Z,
} from '../../game/constants';
import { game } from '../../game/instance';
import type { KartBlockRuntime } from '../../game/types';
import { useGameEvent } from '../../hooks/useGameEvent';
import { getPictureTexture } from '../../utils/answerTexture';
import { clamp01, easeOutBack, easeOutCubic } from '../../utils/math';

/**
 * The rows of pictures the chase drives through.
 *
 * Re-synced on every `kartChase` event — which includes a row entering the
 * tunnel — and animated per frame from the mutable block objects the simulation
 * owns, exactly like `TargetField` and the answer blocks.
 */
export function KartBlocks() {
  const [blocks, setBlocks] = useState<KartBlockRuntime[]>([]);

  const sync = useCallback(() => {
    setBlocks([...game.kart.liveBlocks]);
  }, []);

  useGameEvent('kartChase', sync);
  useGameEvent(
    'state',
    useCallback((payload: { state: string }) => {
      if (payload.state !== 'PLAYING' && payload.state !== 'PAUSED') setBlocks([]);
    }, []),
  );

  return (
    <>
      <RoadLanes />
      {blocks.map((block) => (
        <PictureBlock key={block.id} block={block} />
      ))}
    </>
  );
}

/**
 * The lane guides stop short of the camera. Run all the way to the lens and the
 * nearest metre of the strip fills the bottom of the frame — a glare over the
 * wheel and the stance bar, rather than a guide to where the lanes are.
 */
const LANE_END_Z = -3;
const LANE_RUN = LANE_END_Z - KART_SPAWN_Z;
const LANE_MID_Z = (KART_SPAWN_Z + LANE_END_Z) / 2;

/**
 * Three glowing strips painted down the road, one per lane, with the one the
 * kart is in lit up.
 *
 * This is the answer to "which of these am I actually going to hit?" — and it
 * answers it *before* a row arrives, while the cards are still too far away to
 * read. Without it the only cue is the card highlight, which only exists once
 * there is a card, so every row starts with a moment of hunting.
 */
function RoadLanes() {
  const group = useRef<THREE.Group>(null);
  const mats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);

  useFrame(() => {
    const node = group.current;
    if (!node) return;

    const rush = game.chaseRush;
    const shown = rush > 0.01;
    if (node.visible !== shown) node.visible = shown;
    if (!shown) return;

    const lane = game.input.lane;
    for (let i = 0; i < mats.current.length; i += 1) {
      const material = mats.current[i];
      if (!material) continue;
      // The occupied lane breathes, so it reads even against a busy road.
      const live = i === lane;
      material.opacity =
        rush * (live ? 0.2 + Math.sin(game.time * 6) * 0.045 : 0.05);
    }
  });

  return (
    <group ref={group} visible={false}>
      {KART_LANE_X.map((x, i) => (
        <mesh
          key={i}
          position={[x, KART_LANE_Y, LANE_MID_Z]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <planeGeometry args={[KART_BLOCK_SIZE * 1.1, LANE_RUN]} />
          <meshBasicMaterial
            ref={(material) => {
              mats.current[i] = material;
            }}
            color={COLORS.accent}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * One picture in one lane.
 *
 * Every block looks identical while it is incoming — no colour, no glow, no
 * tell separates an on-topic picture from a decoy. Working that out from the
 * picture itself is the entire game, so the scene only ever reveals it *after*
 * the row has gone past.
 */
function PictureBlock({ block }: { block: KartBlockRuntime }) {
  const group = useRef<THREE.Group>(null);
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);
  const frameMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);

  const texture = useMemo(
    () => getPictureTexture(block.emoji, block.word, COLORS.accent),
    [block.emoji, block.word],
  );

  const neutral = useMemo(() => new THREE.Color(COLORS.accent), []);
  const good = useMemo(() => new THREE.Color(COLORS.correct), []);
  const bad = useMemo(() => new THREE.Color(COLORS.wrong), []);

  useFrame(() => {
    const node = group.current;
    if (!node) return;

    const now = game.time;
    const age = now - block.stateTime;
    const wobble = block.lane * 1.9;
    /**
     * Which way is "outward" from the middle of the road, for this lane. The
     * centre lane has no outward, so it alternates by id — otherwise every
     * centre-lane crash would throw its wreckage the same way.
     */
    const outward = Math.sign(KART_LANE_X[block.lane]) || (block.id % 2 ? 1 : -1);

    let scale = 1;
    let squash = 1;
    let opacity = 1;
    let tint = neutral;
    let rim = 0.75;
    let xOffset = 0;
    let yOffset = 0;
    let zOffset = 0;
    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;
    let targeted = false;

    switch (block.state) {
      case 'INCOMING': {
        // Pop in as it leaves the far end of the tunnel.
        scale = easeOutCubic(clamp01((block.z - KART_SPAWN_Z) / 6));
        // How close the row is, 0 down the tunnel → 1 on top of the player.
        const near = clamp01(1 - block.z / KART_SPAWN_Z);

        // The side lanes turn to face the cockpit, like signs along a road.
        // Costs nothing and does more for the sense of depth and speed than
        // any amount of extra motion would.
        rotY = -outward * 0.34 * (block.lane === 1 ? 0 : 1) * (1 - near * 0.45);
        // Rushing air pushes it: it leans back and stretches as it bears down.
        rotX = -near * 0.12;
        squash = 1 + near * 0.1;
        scale *= 1 + near * near * 0.12;

        yOffset = Math.sin(now * 2.6 + wobble) * 0.09;
        rotZ = Math.sin(now * 1.9 + wobble) * 0.05;

        // The card the kart is lined up with is pulled forward, enlarged and
        // lit — so which one is about to be driven into is never in doubt.
        // It says nothing about whether that card is the *right* one; working
        // that out from the picture is the game.
        targeted = game.input.lane === block.lane;
        if (targeted) {
          const pulse = 0.5 + Math.sin(now * 9) * 0.5;
          scale *= 1.16 + pulse * 0.04;
          rim = 1;
          zOffset = 1.1;
          yOffset -= 0.15;
          rotY *= 0.4;
        }
        break;
      }

      case 'COLLECTED': {
        // Smashed through. Overshoot hard, spin off, and be gone fast — the
        // whole beat has to land inside the gap before the next row arrives.
        const k = clamp01(age / 0.4);
        const e = easeOutCubic(k);
        tint = good;
        scale = easeOutBack(clamp01(k * 1.6)) * 0.6 + 1 + e * 0.45;
        opacity = 1 - k * k;
        // Torn up and over the windscreen rather than straight at the lens —
        // which also keeps it clear of the fade that stops anything filling
        // the screen, so the flare is actually seen.
        yOffset = e * 2.6;
        xOffset = outward * e * 1.8;
        zOffset = e * 1.0;
        rotZ = e * 2.6 * outward;
        rotX = e * 1.1;
        rim = 1;
        break;
      }

      case 'CRASHED': {
        // Hit. Knocked off the road, tumbling on two axes, and it takes longer
        // to clear than a clean pass does — a crash should cost you the view.
        const k = clamp01(age / 0.55);
        const e = easeOutCubic(k);
        tint = bad;
        scale = 1 - k * 0.25;
        squash = 1 - e * 0.35;
        opacity = 1 - k * k;
        xOffset = outward * e * 5.5;
        yOffset = e * 1.4 - k * k * 2.2;
        zOffset = e * 1.2;
        rotZ = e * 4.2 * outward;
        rotX = e * 3.1;
        rotY = e * 1.8 * outward;
        rim = 1;
        break;
      }

      case 'MISSED': {
        // The lane you did not take. It sweeps out of frame sideways rather
        // than fading on the spot, so a row leaves the screen the way it would
        // if you had actually driven past it.
        //
        // Fast, and shrinking as it goes: a card sitting at the strike plane is
        // two and a half times the size it was down the tunnel, so a leisurely
        // fade leaves a billboard-sized ghost over the next row.
        const k = clamp01(age / 0.3);
        const e = easeOutCubic(k);
        opacity = 1 - k * k;
        scale = 1 - e * 0.45;
        xOffset = outward * e * 4.5;
        yOffset = -e * 0.8;
        rotY = -outward * e * 0.7;
        rim = 0.3 * (1 - k);
        break;
      }
    }

    const z = block.z + zOffset;
    // Belt and braces on the same problem: whatever a state animation is doing,
    // nothing is allowed to stay solid once it is on top of the player.
    opacity *= clamp01((KART_DESPAWN_Z + 1 - z) / 2.5);

    node.position.set(KART_LANE_X[block.lane] + xOffset, KART_BLOCK_Y + yOffset, z);
    const size = Math.max(0.001, scale);
    node.scale.set(size * squash, size / squash, size);
    node.rotation.set(rotX, rotY, rotZ);

    if (faceMat.current) faceMat.current.opacity = opacity;
    if (frameMat.current) {
      frameMat.current.color.copy(tint);
      frameMat.current.opacity = opacity * rim;
    }
    if (glowMat.current) {
      glowMat.current.color.copy(tint);
      // Resolved blocks flare rather than merely tinting: the halo is what
      // makes a collect read as a hit from the corner of the eye.
      const flare = block.state !== 'INCOMING' ? 1.6 : targeted ? 0.8 : 0.3;
      glowMat.current.opacity = opacity * rim * flare;
    }
  });

  return (
    <group ref={group} position={[KART_LANE_X[block.lane], KART_BLOCK_Y, block.z]} raycast={() => null}>
      {/* Halo. */}
      <mesh position={[0, 0, -0.3]} scale={1.35} raycast={() => null}>
        <planeGeometry args={[KART_BLOCK_SIZE, KART_BLOCK_SIZE]} />
        <meshBasicMaterial
          ref={glowMat}
          color={COLORS.accent}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Frame — the one thing that changes colour, and only once it is past. */}
      <mesh position={[0, 0, -0.05]} raycast={() => null}>
        <planeGeometry args={[KART_BLOCK_SIZE * 1.08, KART_BLOCK_SIZE * 1.08]} />
        <meshBasicMaterial
          ref={frameMat}
          color={COLORS.accent}
          transparent
          opacity={0.75}
          toneMapped={false}
        />
      </mesh>

      {/* The picture itself. */}
      <mesh raycast={() => null}>
        <planeGeometry args={[KART_BLOCK_SIZE, KART_BLOCK_SIZE]} />
        <meshBasicMaterial ref={faceMat} map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
