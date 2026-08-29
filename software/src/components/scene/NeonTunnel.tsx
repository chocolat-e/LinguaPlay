import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, DESPAWN_Z, TUNNEL_START_Z } from '../../game/constants';
import { game } from '../../game/instance';

const GRID_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Anti-aliased scrolling grid. `fwidth` keeps the line one pixel wide at any
 * distance, which is what stops far-off lines turning into moire soup.
 */
const GRID_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uScroll;
  uniform vec2 uRepeat;
  uniform vec3 uNear;
  uniform vec3 uFar;
  uniform float uOpacity;

  void main() {
    vec2 uv = vUv * uRepeat;
    uv.y += uScroll;

    vec2 grid = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
    float line = min(grid.x, grid.y);
    float strength = 1.0 - min(line, 1.0);

    // Fade out toward the far end of the plane so there is no hard edge.
    float depthFade = 1.0 - smoothstep(0.45, 1.0, vUv.y);
    float nearFade = smoothstep(0.0, 0.06, vUv.y);

    vec3 color = mix(uNear, uFar, smoothstep(0.0, 0.8, vUv.y));
    float alpha = strength * depthFade * nearFade * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * @param speed base scroll rate. Kept on `userData` rather than in a uniform
 *   because the frame loop scales it by the chase rush and integrates it — a
 *   `time * speed` uniform would make the grid jump every time the rate moved.
 */
function useGridMaterial(near: string, far: string, repeat: [number, number], speed: number, opacity: number) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uScroll: { value: 0 },
          uRepeat: { value: new THREE.Vector2(repeat[0], repeat[1]) },
          uNear: { value: new THREE.Color(near) },
          uFar: { value: new THREE.Color(far) },
          uOpacity: { value: opacity },
        },
        userData: { baseSpeed: speed, baseOpacity: opacity },
      }),
    [near, far, repeat, speed, opacity],
  );
}

/** Rectangular frame geometry (an outlined rounded rect), used for tunnel rings. */
function useFrameGeometry(width: number, height: number, thickness: number) {
  return useMemo(() => {
    const shape = new THREE.Shape();
    const w = width / 2;
    const h = height / 2;
    shape.moveTo(-w, -h);
    shape.lineTo(w, -h);
    shape.lineTo(w, h);
    shape.lineTo(-w, h);
    shape.closePath();

    const hole = new THREE.Path();
    const iw = w - thickness;
    const ih = h - thickness;
    hole.moveTo(-iw, -ih);
    hole.lineTo(iw, -ih);
    hole.lineTo(iw, ih);
    hole.lineTo(-iw, ih);
    hole.closePath();
    shape.holes.push(hole);

    return new THREE.ShapeGeometry(shape);
  }, [width, height, thickness]);
}

const RING_COUNT = 14;
const RING_SPACING = 12;
const RING_START = TUNNEL_START_Z;
const RING_END = DESPAWN_Z + 6;
const RING_SPAN = RING_END - RING_START;

/**
 * The whole playfield backdrop: grid floor / ceiling / walls, tunnel rings
 * rushing past the player, and drifting dust. Deliberately holds nothing at the
 * strike plane itself — the answer blocks own that space.
 */
export function NeonTunnel() {
  const floorMat = useGridMaterial(COLORS.grid, COLORS.gridFar, [22, 60], 0.055, 0.55);
  const ceilMat = useGridMaterial(COLORS.grid, COLORS.gridFar, [22, 60], 0.04, 0.14);
  const leftMat = useGridMaterial(COLORS.grid, COLORS.gridFar, [12, 60], 0.05, 0.2);
  const rightMat = useGridMaterial(COLORS.grid, COLORS.gridFar, [12, 60], 0.05, 0.2);

  const ringGeometry = useFrameGeometry(26, 15, 0.28);
  const rings = useRef<THREE.Mesh[]>([]);
  const dust = useRef<THREE.Points>(null);

  const dustGeometry = useMemo(() => {
    const count = 190;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = Math.random() * 14 - 2;
      positions[i * 3 + 2] = TUNNEL_START_Z + Math.random() * (RING_SPAN + 20);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = game.time;

    // The road is what sells the speed. During a chase everything in the
    // tunnel — grid, rings, dust — runs several times faster and brighter, and
    // because `chaseRush` ramps rather than snapping, the world visibly winds
    // up into the chase and coasts back out of it.
    const rush = game.chaseRush;
    const scroll = 1 + rush * 4.2;

    for (const material of [floorMat, ceilMat, leftMat, rightMat]) {
      material.uniforms.uScroll.value += material.userData.baseSpeed * scroll * dt * 12;
      material.uniforms.uOpacity.value =
        material.userData.baseOpacity * (1 + rush * 0.85);
    }

    // Rings sweep toward the player and wrap around.
    const ringSpeed = (26 + game.beatPulse * 12) * (1 + rush * 2.7);
    for (const ring of rings.current) {
      if (!ring) continue;
      ring.position.z += ringSpeed * dt;
      if (ring.position.z > RING_END) ring.position.z -= RING_SPAN;
      const depth = (RING_END - ring.position.z) / RING_SPAN;
      const material = ring.material as THREE.MeshBasicMaterial;
      material.opacity = (0.22 * (1 - depth) + 0.03) * (1 + rush * 1.6);
      // Squeezed vertically at speed, so the rings read as a throat being torn
      // through rather than as hoops standing still.
      ring.scale.set(1 + rush * 0.06, 1 - rush * 0.05, 1);
    }

    // Dust drifts forward — and streaks past once the kart is moving.
    const dustSpeed = 9 * (1 + rush * 7);
    const positions = dustGeometry.attributes.position as THREE.BufferAttribute;
    const array = positions.array as Float32Array;
    for (let i = 2; i < array.length; i += 3) {
      array[i] += dustSpeed * dt;
      if (array[i] > RING_END + 10) array[i] = TUNNEL_START_Z;
    }
    positions.needsUpdate = true;
    if (dust.current) {
      dust.current.rotation.z = Math.sin(t * 0.08) * 0.05;
      const material = dust.current.material as THREE.PointsMaterial;
      material.opacity = 0.25 + rush * 0.45;
      material.size = 0.08 + rush * 0.05;
    }
  });

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, -70]} material={floorMat}>
        <planeGeometry args={[90, 230]} />
      </mesh>
      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 12.5, -70]} material={ceilMat}>
        <planeGeometry args={[90, 230]} />
      </mesh>
      {/* Walls */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-15, 5, -70]} material={leftMat}>
        <planeGeometry args={[230, 30]} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[15, 5, -70]} material={rightMat}>
        <planeGeometry args={[230, 30]} />
      </mesh>

      {/* Tunnel rings */}
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            if (node) rings.current[i] = node;
          }}
          geometry={ringGeometry}
          position={[0, 5, RING_START + i * RING_SPACING]}
        >
          <meshBasicMaterial
            color={COLORS.accentDeep}
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Dust motes */}
      <points ref={dust} geometry={dustGeometry}>
        <pointsMaterial
          size={0.08}
          color={COLORS.accentSoft}
          transparent
          opacity={0.25}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

