import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Float, Sparkles, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { RoomConfig, Zone } from '../types';

// ── Agent screen colors ──────────────────────────────────────────────
const SCREEN_COLORS: Record<string, string> = {
  Margot: '#ff2244',
  Bud: '#2266ff',
  Lou: '#22cc66',
  Nygma: '#9944ff',
  Ivy: '#ff8822',
  Harvey: '#888899',
};

// ── Default room config — identical layout ───────────────────────────
export const DEFAULT_ROOM: RoomConfig = {
  width: 30,
  depth: 30,
  zones: [
    {
      id: 'desk-margot',
      name: 'Margot',
      type: 'desk',
      position: { x: -8, y: 0, z: -6 },
      size: { width: 3, depth: 2 },
    },
    {
      id: 'desk-bud',
      name: 'Bud',
      type: 'desk',
      position: { x: -3, y: 0, z: -6 },
      size: { width: 3, depth: 2 },
    },
    {
      id: 'desk-lou',
      name: 'Lou',
      type: 'desk',
      position: { x: 2, y: 0, z: -6 },
      size: { width: 3, depth: 2 },
    },
    {
      id: 'desk-nygma',
      name: 'Nygma',
      type: 'desk',
      position: { x: 7, y: 0, z: -6 },
      size: { width: 3, depth: 2 },
    },
    {
      id: 'desk-ivy',
      name: 'Ivy',
      type: 'desk',
      position: { x: -8, y: 0, z: -1 },
      size: { width: 3, depth: 2 },
    },
    {
      id: 'desk-harvey',
      name: 'Harvey',
      type: 'desk',
      position: { x: -3, y: 0, z: -1 },
      size: { width: 3, depth: 2 },
    },
    {
      id: 'lounge',
      name: 'Lounge',
      type: 'lounge',
      position: { x: 6, y: 0, z: 4 },
      size: { width: 8, depth: 6 },
      color: '#1e2d40',
    },
    {
      id: 'meeting',
      name: 'Meeting Room',
      type: 'meeting',
      position: { x: -6, y: 0, z: 6 },
      size: { width: 7, depth: 5 },
      color: '#2d1e40',
    },
  ],
};

// ── Textured wood floor with subtle neon grid overlay ────────────────
function FloorGrid({ width, depth }: { width: number; depth: number }) {
  const [diff, nor, rough] = useTexture([
    '/textures/floor/diff.jpg',
    '/textures/floor/nor.jpg',
    '/textures/floor/rough.jpg',
  ]);
  useMemo(() => {
    [diff, nor, rough].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(8, 8);
      t.anisotropy = 8;
    });
    diff.colorSpace = THREE.SRGBColorSpace;
  }, [diff, nor, rough]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          map={diff}
          normalMap={nor}
          roughnessMap={rough}
          roughness={0.9}
          metalness={0.05}
        />
      </mesh>
      {/* Subtle neon grid — cyberpunk flavor on top of wood */}
      <gridHelper args={[width, width * 2, '#1a1a3a', '#141428']} position={[0, 0.001, 0]} />
      <gridHelper args={[width, width / 2, '#2e1e5e', '#2e1e5e']} position={[0, 0.002, 0]} />
    </group>
  );
}

// ── Glow strip (emissive bar along wall base) ────────────────────────
function GlowStrip({
  position,
  width: w,
  rotation = 0,
}: {
  position: [number, number, number];
  width: number;
  rotation?: number;
}) {
  return (
    <mesh position={position} rotation-y={rotation}>
      <boxGeometry args={[w, 0.04, 0.06]} />
      <meshStandardMaterial
        color="#6622cc"
        emissive="#6622cc"
        emissiveIntensity={2.5}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── Walls with emissive trim ─────────────────────────────────────────
function Walls({ width, depth }: { width: number; depth: number }) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallHeight = 3.5;

  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a2c',
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        metalness: 0.3,
        roughness: 0.7,
      }),
    [],
  );

  const trimMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3a2a6e',
        emissive: '#3a2a6e',
        emissiveIntensity: 1.2,
        toneMapped: false,
      }),
    [],
  );

  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, wallHeight / 2, -halfD]} material={wallMaterial}>
        <planeGeometry args={[width, wallHeight]} />
      </mesh>
      {/* Back wall top trim */}
      <mesh position={[0, wallHeight, -halfD + 0.01]} material={trimMaterial}>
        <boxGeometry args={[width, 0.03, 0.03]} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-halfW, wallHeight / 2, 0]} rotation-y={Math.PI / 2} material={wallMaterial}>
        <planeGeometry args={[depth, wallHeight]} />
      </mesh>
      {/* Left wall top trim */}
      <mesh
        position={[-halfW + 0.01, wallHeight, 0]}
        rotation-y={Math.PI / 2}
        material={trimMaterial}
      >
        <boxGeometry args={[depth, 0.03, 0.03]} />
      </mesh>
      {/* Right wall */}
      <mesh position={[halfW, wallHeight / 2, 0]} rotation-y={-Math.PI / 2} material={wallMaterial}>
        <planeGeometry args={[depth, wallHeight]} />
      </mesh>
      {/* Right wall top trim */}
      <mesh
        position={[halfW - 0.01, wallHeight, 0]}
        rotation-y={Math.PI / 2}
        material={trimMaterial}
      >
        <boxGeometry args={[depth, 0.03, 0.03]} />
      </mesh>

      {/* Glow strips along wall bases */}
      <GlowStrip position={[0, 0.02, -halfD + 0.04]} width={width} />
      <GlowStrip position={[-halfW + 0.04, 0.02, 0]} width={depth} rotation={Math.PI / 2} />
      <GlowStrip position={[halfW - 0.04, 0.02, 0]} width={depth} rotation={Math.PI / 2} />

      {/* Vertical corner accents */}
      {[
        [-halfW, -halfD],
        [halfW, -halfD],
      ].map(([cx, cz], i) => (
        <mesh key={i} position={[cx, wallHeight / 2, cz]}>
          <boxGeometry args={[0.04, wallHeight, 0.04]} />
          <meshStandardMaterial
            color="#4422aa"
            emissive="#4422aa"
            emissiveIntensity={1.5}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Ceiling with recessed light spots ────────────────────────────────
function Ceiling({ width, depth }: { width: number; depth: number }) {
  const ceilingY = 3.5;
  // Generate a grid of light spots
  const lights = useMemo(() => {
    const pts: [number, number][] = [];
    const spacingX = 5;
    const spacingZ = 5;
    for (let x = -width / 2 + spacingX; x < width / 2; x += spacingX) {
      for (let z = -depth / 2 + spacingZ; z < depth / 2; z += spacingZ) {
        pts.push([x, z]);
      }
    }
    return pts;
  }, [width, depth]);

  return (
    <group>
      {/* Ceiling plane */}
      <mesh rotation-x={Math.PI / 2} position={[0, ceilingY, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#0a0a14" side={THREE.DoubleSide} transparent opacity={0.85} />
      </mesh>
      {/* Recessed light spots */}
      {lights.map(([lx, lz], i) => (
        <group key={i}>
          <mesh position={[lx, ceilingY - 0.01, lz]} rotation-x={Math.PI / 2}>
            <circleGeometry args={[0.3, 16]} />
            <meshStandardMaterial
              color="#4444aa"
              emissive="#4444aa"
              emissiveIntensity={2}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <pointLight
            position={[lx, ceilingY - 0.2, lz]}
            color="#3333aa"
            intensity={0.4}
            distance={6}
            decay={2}
          />
        </group>
      ))}
    </group>
  );
}

// ── Chair (simple geometry) ──────────────────────────────────────────
const Chair = React.memo(function Chair({ position: pos }: { position: [number, number, number] }) {
  const seatH = 0.45;
  const seatD = 0.4;
  const seatW = 0.4;
  return (
    <group position={pos}>
      {/* Seat */}
      <mesh position={[0, seatH, 0]}>
        <boxGeometry args={[seatW, 0.04, seatD]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, seatH + 0.22, -seatD / 2 + 0.02]}>
        <boxGeometry args={[seatW, 0.4, 0.04]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Center post */}
      <mesh position={[0, seatH / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, seatH, 8]} />
        <meshStandardMaterial color="#111120" metalness={0.6} />
      </mesh>
      {/* Base */}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.04, 8]} />
        <meshStandardMaterial color="#111120" metalness={0.6} />
      </mesh>
    </group>
  );
});

// ── Desk lamp (accent light) ─────────────────────────────────────────
const DeskLamp = React.memo(function DeskLamp({
  position: pos,
  color,
}: {
  position: [number, number, number];
  color: string;
}) {
  return (
    <group position={pos}>
      {/* Base */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 0.03, 8]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.5} />
      </mesh>
      {/* Arm */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.3, 6]} />
        <meshStandardMaterial color="#2a2a40" metalness={0.4} />
      </mesh>
      {/* Shade / emitter */}
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, 0.32, 0]} color={color} intensity={0.3} distance={2.5} decay={2} />
    </group>
  );
});

// ── Upgraded desk with keyboard tray, chair, glowing monitor, lamp ───
const Desk = React.memo(function Desk({ zone }: { zone: Zone }) {
  const { position, size, name } = zone;
  const deskHeight = 0.75;
  const screenColor = SCREEN_COLORS[name] || '#4444aa';

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Desk surface */}
      <mesh position={[0, deskHeight, 0]} castShadow>
        <boxGeometry args={[size.width, 0.05, size.depth]} />
        <meshStandardMaterial color="#22223a" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Desk edge accent strip */}
      <mesh position={[0, deskHeight + 0.026, size.depth / 2]}>
        <boxGeometry args={[size.width, 0.008, 0.02]} />
        <meshStandardMaterial
          color={screenColor}
          emissive={screenColor}
          emissiveIntensity={1.5}
          toneMapped={false}
        />
      </mesh>
      {/* Panel sides */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (size.width / 2 - 0.03), deskHeight / 2, 0]}>
          <boxGeometry args={[0.04, deskHeight, size.depth]} />
          <meshStandardMaterial color="#181828" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
      {/* Back panel */}
      <mesh position={[0, deskHeight / 2, -(size.depth / 2 - 0.02)]}>
        <boxGeometry args={[size.width - 0.08, deskHeight * 0.6, 0.03]} />
        <meshStandardMaterial color="#181828" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* Keyboard tray */}
      <mesh position={[0, deskHeight - 0.12, 0.15]}>
        <boxGeometry args={[size.width * 0.6, 0.02, size.depth * 0.35]} />
        <meshStandardMaterial color="#1e1e30" metalness={0.2} roughness={0.6} />
      </mesh>

      {/* Monitor */}
      <mesh position={[0, deskHeight + 0.4, -(size.depth / 2 - 0.15)]}>
        <boxGeometry args={[0.9, 0.55, 0.03]} />
        <meshStandardMaterial color="#080810" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Monitor screen (inner face — emissive) */}
      <mesh position={[0, deskHeight + 0.4, -(size.depth / 2 - 0.13)]}>
        <planeGeometry args={[0.82, 0.47]} />
        <meshStandardMaterial
          color={screenColor}
          emissive={screenColor}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, deskHeight + 0.05, -(size.depth / 2 - 0.15)]}>
        <boxGeometry args={[0.08, 0.12, 0.08]} />
        <meshStandardMaterial color="#111120" metalness={0.5} />
      </mesh>
      {/* Monitor base */}
      <mesh position={[0, deskHeight + 0.01, -(size.depth / 2 - 0.15)]}>
        <boxGeometry args={[0.25, 0.02, 0.15]} />
        <meshStandardMaterial color="#111120" metalness={0.5} />
      </mesh>

      {/* Desk lamp */}
      <DeskLamp
        position={[size.width / 2 - 0.25, deskHeight + 0.025, size.depth / 2 - 0.2]}
        color={screenColor}
      />

      {/* Chair */}
      <Chair position={[0, 0, size.depth / 2 + 0.5]} />

      {/* Name label */}
      <Text
        position={[0, 2.4, 0]}
        fontSize={0.28}
        color={screenColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        {name}
      </Text>
    </group>
  );
});

// ── Holographic projection (floating, animated) ──────────────────────
function HolographicDisplay({
  position: pos,
  size = 1.2,
  color = '#4466ff',
}: {
  position: [number, number, number];
  size?: number;
  color?: string;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ringRef.current) {
      ringRef.current.rotation.y = t * 0.5;
      ringRef.current.rotation.z = Math.sin(t * 0.3) * 0.1;
    }
    if (innerRef.current) {
      innerRef.current.rotation.y = -t * 0.8;
    }
  });

  return (
    <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <group position={pos}>
        {/* Base ring */}
        <mesh position={[0, -0.3, 0]} rotation-x={Math.PI / 2}>
          <ringGeometry args={[size * 0.35, size * 0.4, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={2}
            toneMapped={false}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Outer ring */}
        <mesh ref={ringRef}>
          <torusGeometry args={[size * 0.5, 0.015, 8, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={3}
            toneMapped={false}
            transparent
            opacity={0.5}
          />
        </mesh>
        {/* Inner icosahedron */}
        <mesh ref={innerRef}>
          <icosahedronGeometry args={[size * 0.2, 0]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={2}
            toneMapped={false}
            transparent
            opacity={0.4}
            wireframe
          />
        </mesh>
        {/* Glow light */}
        <pointLight color={color} intensity={0.6} distance={4} decay={2} />
      </group>
    </Float>
  );
}

// ── Lounge area — sofa shapes, low table, holographic display ────────
const LoungeArea = React.memo(function LoungeArea({ zone }: { zone: Zone }) {
  const { position, size, name } = zone;
  const sofaColor = '#1a1a30';
  const accentColor = '#1e4466';

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Zone floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]}>
        <planeGeometry args={[size.width, size.depth]} />
        <meshStandardMaterial color="#0e1e2e" transparent opacity={0.6} metalness={0.2} />
      </mesh>
      {/* Zone border accent */}
      {[
        { pos: [0, 0.01, -size.depth / 2] as [number, number, number], w: size.width, d: 0.03 },
        { pos: [0, 0.01, size.depth / 2] as [number, number, number], w: size.width, d: 0.03 },
        { pos: [-size.width / 2, 0.01, 0] as [number, number, number], w: 0.03, d: size.depth },
        { pos: [size.width / 2, 0.01, 0] as [number, number, number], w: 0.03, d: size.depth },
      ].map(({ pos: p, w, d }, i) => (
        <mesh key={i} position={p} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Low table */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.5, 0.04, 0.8]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Table legs */}
      {[
        [-0.6, 0.15, -0.3],
        [0.6, 0.15, -0.3],
        [-0.6, 0.15, 0.3],
        [0.6, 0.15, 0.3],
      ].map(([lx, ly, lz], i) => (
        <mesh key={i} position={[lx, ly, lz]}>
          <boxGeometry args={[0.04, 0.28, 0.04]} />
          <meshStandardMaterial color="#111120" metalness={0.5} />
        </mesh>
      ))}

      {/* Sofa — back */}
      <mesh position={[0, 0.35, -size.depth / 2 + 0.7]}>
        <boxGeometry args={[2.4, 0.6, 0.7]} />
        <meshStandardMaterial color={sofaColor} metalness={0.2} roughness={0.8} />
      </mesh>
      {/* Sofa backrest */}
      <mesh position={[0, 0.7, -size.depth / 2 + 0.4]}>
        <boxGeometry args={[2.4, 0.3, 0.15]} />
        <meshStandardMaterial color={sofaColor} metalness={0.2} roughness={0.8} />
      </mesh>
      {/* Sofa armrests */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.3, 0.45, -size.depth / 2 + 0.7]}>
          <boxGeometry args={[0.2, 0.35, 0.7]} />
          <meshStandardMaterial color={sofaColor} metalness={0.2} roughness={0.8} />
        </mesh>
      ))}

      {/* Side chair (rounded-box sofa shape) */}
      <mesh position={[size.width / 2 - 1, 0.3, 0.5]}>
        <boxGeometry args={[0.8, 0.5, 0.8]} />
        <meshStandardMaterial color={sofaColor} metalness={0.2} roughness={0.8} />
      </mesh>

      {/* Holographic display above table */}
      <HolographicDisplay position={[0, 1.2, 0]} size={0.8} color="#2288ff" />

      {/* Zone label */}
      <Text
        position={[0, 0.02, size.depth / 2 - 0.4]}
        rotation-x={-Math.PI / 2}
        fontSize={0.35}
        color="#335577"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </group>
  );
});

// ── Meeting room — table, chairs, large holographic display ──────────
const MeetingRoom = React.memo(function MeetingRoom({ zone }: { zone: Zone }) {
  const { position, size, name } = zone;
  const accentColor = '#442266';

  // Generate chairs around table
  const chairPositions: [number, number, number][] = useMemo(() => {
    const chairs: [number, number, number][] = [];
    const tableW = 2.5;
    const tableD = 1.2;
    // Along long sides
    for (let i = 0; i < 3; i++) {
      const x = -tableW / 2 + 0.5 + i * (tableW / 3);
      chairs.push([x, 0, tableD / 2 + 0.4]);
      chairs.push([x, 0, -(tableD / 2 + 0.4)]);
    }
    return chairs;
  }, []);

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Zone floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]}>
        <planeGeometry args={[size.width, size.depth]} />
        <meshStandardMaterial color="#160e28" transparent opacity={0.6} metalness={0.2} />
      </mesh>
      {/* Zone border accent */}
      {[
        { pos: [0, 0.01, -size.depth / 2] as [number, number, number], w: size.width, d: 0.03 },
        { pos: [0, 0.01, size.depth / 2] as [number, number, number], w: size.width, d: 0.03 },
        { pos: [-size.width / 2, 0.01, 0] as [number, number, number], w: 0.03, d: size.depth },
        { pos: [size.width / 2, 0.01, 0] as [number, number, number], w: 0.03, d: size.depth },
      ].map(({ pos: p, w, d }, i) => (
        <mesh key={i} position={p} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Conference table */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[2.5, 0.06, 1.2]} />
        <meshStandardMaterial color="#1e1a30" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* Table edge accent */}
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[2.52, 0.01, 1.22]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={1.5}
          toneMapped={false}
          transparent
          opacity={0.6}
        />
      </mesh>
      {/* Table legs */}
      {[
        [-1.0, 0.36, -0.45],
        [1.0, 0.36, -0.45],
        [-1.0, 0.36, 0.45],
        [1.0, 0.36, 0.45],
      ].map(([lx, ly, lz], i) => (
        <mesh key={i} position={[lx, ly, lz]}>
          <boxGeometry args={[0.06, 0.7, 0.06]} />
          <meshStandardMaterial color="#14122a" metalness={0.5} />
        </mesh>
      ))}

      {/* Chairs */}
      {chairPositions.map((cPos, i) => (
        <Chair key={i} position={cPos} />
      ))}

      {/* Large holographic display */}
      <HolographicDisplay position={[0, 1.8, 0]} size={1.4} color="#8844ff" />

      {/* Zone label */}
      <Text
        position={[0, 0.02, size.depth / 2 - 0.4]}
        rotation-x={-Math.PI / 2}
        fontSize={0.35}
        color="#554477"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </group>
  );
});

// ── Ambient particles ────────────────────────────────────────────────
function Atmosphere({ width, depth }: { width: number; depth: number }) {
  return (
    <Sparkles
      count={50}
      scale={[width * 0.8, 3, depth * 0.8]}
      size={1.5}
      speed={0.2}
      opacity={0.3}
      color="#4444cc"
      position={[0, 1.5, 0]}
    />
  );
}

// ── Room component ───────────────────────────────────────────────────
interface RoomProps {
  config?: RoomConfig;
}

export function Room({ config }: RoomProps) {
  const room = config || DEFAULT_ROOM;
  const desks = room.zones.filter((z) => z.type === 'desk');
  const lounges = room.zones.filter((z) => z.type === 'lounge');
  const meetings = room.zones.filter((z) => z.type === 'meeting');

  return (
    <group>
      <FloorGrid width={room.width} depth={room.depth} />
      <Walls width={room.width} depth={room.depth} />
      <Ceiling width={room.width} depth={room.depth} />
      <Atmosphere width={room.width} depth={room.depth} />
      {desks.map((z) => (
        <Desk key={z.id} zone={z} />
      ))}
      {lounges.map((z) => (
        <LoungeArea key={z.id} zone={z} />
      ))}
      {meetings.map((z) => (
        <MeetingRoom key={z.id} zone={z} />
      ))}
    </group>
  );
}
