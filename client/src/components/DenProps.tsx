import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

// ── Bookshelf — wall-mounted shelves with colored book spines ─────────
export const Bookshelf = React.memo(function Bookshelf({
  position,
  rotation = 0,
}: {
  position: [number, number, number];
  rotation?: number;
}) {
  const width = 2.2;
  const height = 2.6;
  const depth = 0.35;
  const shelfCount = 5;

  // Deterministic book pattern — muted palette with a couple of neon spines
  // for character (glowing books = cozy dev-cyberpunk staple).
  const books = useMemo(() => {
    const palette = [
      { color: '#4a2e1a', emissive: '#000000', intensity: 0 },
      { color: '#2e3a5c', emissive: '#000000', intensity: 0 },
      { color: '#6b2e2e', emissive: '#000000', intensity: 0 },
      { color: '#2a4a3a', emissive: '#000000', intensity: 0 },
      { color: '#5a4a2e', emissive: '#000000', intensity: 0 },
      { color: '#3a2e5a', emissive: '#3a2e5a', intensity: 0.8 },
      { color: '#1a4a5c', emissive: '#000000', intensity: 0 },
      { color: '#4a3a1a', emissive: '#000000', intensity: 0 },
      { color: '#2e5a4a', emissive: '#2e5a4a', intensity: 0.6 },
      { color: '#5c2e4a', emissive: '#000000', intensity: 0 },
    ];
    const shelves = [];
    for (let s = 0; s < shelfCount - 1; s++) {
      const shelfBooks = [];
      let x = -width / 2 + 0.1;
      let i = s * 7;
      while (x < width / 2 - 0.1) {
        const bw = 0.08 + ((i * 31) % 7) * 0.015;
        const bh = 0.32 + ((i * 17) % 5) * 0.04;
        const p = palette[(i * 13) % palette.length];
        shelfBooks.push({ x: x + bw / 2, bw, bh, ...p });
        x += bw + 0.005;
        i++;
      }
      shelves.push(shelfBooks);
    }
    return shelves;
  }, []);

  return (
    <group position={position} rotation-y={rotation}>
      {/* Back panel */}
      <mesh position={[0, height / 2, -depth / 2 + 0.01]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshStandardMaterial color="#181824" roughness={0.9} />
      </mesh>
      {/* Frame sides */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2), height / 2, 0]}>
          <boxGeometry args={[0.04, height, depth]} />
          <meshStandardMaterial color="#1a1a28" metalness={0.2} roughness={0.6} />
        </mesh>
      ))}
      {/* Top & bottom */}
      <mesh position={[0, height - 0.02, 0]}>
        <boxGeometry args={[width, 0.04, depth]} />
        <meshStandardMaterial color="#1a1a28" metalness={0.2} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[width, 0.04, depth]} />
        <meshStandardMaterial color="#1a1a28" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Shelves */}
      {Array.from({ length: shelfCount }).map((_, i) => {
        const y = (i / (shelfCount - 1)) * (height - 0.05) + 0.025;
        return (
          <mesh key={i} position={[0, y, 0]}>
            <boxGeometry args={[width - 0.08, 0.02, depth - 0.05]} />
            <meshStandardMaterial color="#22223a" metalness={0.2} roughness={0.7} />
          </mesh>
        );
      })}
      {/* Under-shelf glow strips (the cyberpunk part) */}
      {Array.from({ length: shelfCount - 1 }).map((_, i) => {
        const y = ((i + 1) / (shelfCount - 1)) * (height - 0.05) + 0.014;
        return (
          <mesh key={`glow-${i}`} position={[0, y, depth / 2 - 0.02]}>
            <boxGeometry args={[width - 0.12, 0.008, 0.01]} />
            <meshStandardMaterial
              color="#6644dd"
              emissive="#6644dd"
              emissiveIntensity={2}
              toneMapped={false}
            />
          </mesh>
        );
      })}
      {/* Books */}
      {books.map((shelf, si) => {
        const shelfY = (si / (shelfCount - 1)) * (height - 0.05) + 0.05;
        return shelf.map((b, bi) => (
          <mesh key={`${si}-${bi}`} position={[b.x, shelfY + b.bh / 2, -0.02]} castShadow>
            <boxGeometry args={[b.bw, b.bh, depth - 0.12]} />
            <meshStandardMaterial
              color={b.color}
              emissive={b.emissive}
              emissiveIntensity={b.intensity}
              toneMapped={b.intensity === 0}
              roughness={0.8}
            />
          </mesh>
        ));
      })}
    </group>
  );
});

// ── Potted Plant — cozy greenery with subtle leaf glow ────────────────
export const PottedPlant = React.memo(function PottedPlant({
  position,
  scale = 1,
  glow = false,
}: {
  position: [number, number, number];
  scale?: number;
  glow?: boolean;
}) {
  const potHeight = 0.3 * scale;
  const potTop = 0.22 * scale;
  const potBottom = 0.16 * scale;

  // Generate a bushy shape via randomized sphere clusters
  const leaves = useMemo(() => {
    const pts: { pos: [number, number, number]; size: number }[] = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 0.18 + (((i * 37) % 5) / 5) * 0.1;
      const y = 0.15 + (((i * 19) % 7) / 7) * 0.35;
      pts.push({
        pos: [Math.cos(angle) * r, y, Math.sin(angle) * r],
        size: 0.11 + (((i * 23) % 5) / 5) * 0.08,
      });
    }
    return pts;
  }, []);

  return (
    <group position={position} scale={scale}>
      {/* Terracotta pot */}
      <mesh position={[0, potHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[potTop, potBottom, potHeight, 16]} />
        <meshStandardMaterial color="#4a2a1e" roughness={0.9} metalness={0.05} />
      </mesh>
      {/* Pot rim */}
      <mesh position={[0, potHeight - 0.01, 0]}>
        <torusGeometry args={[potTop - 0.01, 0.015, 6, 16]} />
        <meshStandardMaterial color="#3a1e12" roughness={0.9} />
      </mesh>
      {/* Soil */}
      <mesh position={[0, potHeight - 0.01, 0]}>
        <cylinderGeometry args={[potTop - 0.02, potTop - 0.02, 0.02, 12]} />
        <meshStandardMaterial color="#1a0f08" roughness={1} />
      </mesh>
      {/* Leaves — sphere clusters */}
      {leaves.map((l, i) => (
        <mesh key={i} position={[l.pos[0], potHeight + l.pos[1], l.pos[2]]} castShadow>
          <icosahedronGeometry args={[l.size, 0]} />
          <meshStandardMaterial
            color={glow ? '#44dd88' : '#2d5a3a'}
            emissive={glow ? '#44dd88' : '#0a2010'}
            emissiveIntensity={glow ? 0.6 : 0.1}
            roughness={0.7}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
});

// ── Wall Poster — emissive framed panel with synthwave text ───────────
export const WallPoster = React.memo(function WallPoster({
  position,
  rotation = 0,
  title,
  subtitle,
  color = '#ff2288',
  size = [1.4, 1.8],
}: {
  position: [number, number, number];
  rotation?: number;
  title: string;
  subtitle?: string;
  color?: string;
  size?: [number, number];
}) {
  const [w, h] = size;
  return (
    <group position={position} rotation-y={rotation}>
      {/* Backing panel (dark) */}
      <mesh position={[0, 0, -0.015]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#0a0a18" roughness={0.8} />
      </mesh>
      {/* Neon frame — 4 edge strips */}
      <mesh position={[0, h / 2 - 0.02, 0]}>
        <boxGeometry args={[w, 0.015, 0.01]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -h / 2 + 0.02, 0]}>
        <boxGeometry args={[w, 0.015, 0.01]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[-w / 2 + 0.02, 0, 0]}>
        <boxGeometry args={[0.015, h, 0.01]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[w / 2 - 0.02, 0, 0]}>
        <boxGeometry args={[0.015, h, 0.01]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      {/* Inner gradient-ish band */}
      <mesh position={[0, h / 4, -0.01]}>
        <planeGeometry args={[w - 0.1, h / 3]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          transparent
          opacity={0.15}
          toneMapped={false}
        />
      </mesh>
      {/* Title */}
      <Text
        position={[0, 0.05, 0.001]}
        fontSize={0.18}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor="#000000"
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          position={[0, -0.2, 0.001]}
          fontSize={0.08}
          color="#ccaaff"
          anchorX="center"
          anchorY="middle"
        >
          {subtitle}
        </Text>
      )}
    </group>
  );
});

// ── Coffee Mug — small desk clutter item with optional steam glow ─────
export const CoffeeMug = React.memo(function CoffeeMug({
  position,
  color = '#7744aa',
}: {
  position: [number, number, number];
  color?: string;
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* Handle */}
      <mesh position={[0.045, 0, 0]} rotation-z={Math.PI / 2}>
        <torusGeometry args={[0.025, 0.008, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Coffee surface */}
      <mesh position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.005, 12]} />
        <meshStandardMaterial color="#2a1a0e" roughness={0.5} />
      </mesh>
    </group>
  );
});

// ── String Lights — strand of small emissive points along a line ──────
export const StringLights = React.memo(function StringLights({
  from,
  to,
  count = 12,
  color = '#ffcc88',
}: {
  from: [number, number, number];
  to: [number, number, number];
  count?: number;
  color?: string;
}) {
  const points = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      // Gentle sag between endpoints
      const sag = Math.sin(t * Math.PI) * 0.15;
      pts.push([
        THREE.MathUtils.lerp(from[0], to[0], t),
        THREE.MathUtils.lerp(from[1], to[1], t) - sag,
        THREE.MathUtils.lerp(from[2], to[2], t),
      ]);
    }
    return pts;
  }, [from, to, count]);

  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.025, 6, 6]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
});

// ── Floor Rug — flat patterned panel for the lounge/center area ───────
export const FloorRug = React.memo(function FloorRug({
  position,
  size = [4, 3],
  color = '#3a1e5c',
  accent = '#ff44aa',
}: {
  position: [number, number, number];
  size?: [number, number];
  color?: string;
  accent?: string;
}) {
  const [w, d] = size;
  return (
    <group position={position}>
      {/* Rug base */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.007, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      {/* Accent border */}
      {[
        { pos: [0, 0.008, -d / 2 + 0.05] as [number, number, number], sx: w - 0.1, sz: 0.05 },
        { pos: [0, 0.008, d / 2 - 0.05] as [number, number, number], sx: w - 0.1, sz: 0.05 },
        { pos: [-w / 2 + 0.05, 0.008, 0] as [number, number, number], sx: 0.05, sz: d - 0.1 },
        { pos: [w / 2 - 0.05, 0.008, 0] as [number, number, number], sx: 0.05, sz: d - 0.1 },
      ].map((b, i) => (
        <mesh key={i} position={b.pos} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[b.sx, b.sz]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={0.8}
            toneMapped={false}
          />
        </mesh>
      ))}
      {/* Center diamond accent */}
      <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 4} position={[0, 0.009, 0]}>
        <planeGeometry args={[Math.min(w, d) * 0.35, Math.min(w, d) * 0.35]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.5}
          transparent
          opacity={0.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});

// ── Den Props container — drop-in set of cozy furniture for the room ──
export function DenProps({ width, depth }: { width: number; depth: number }) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallInset = 0.3; // how far off the back wall bookshelves sit

  return (
    <group>
      {/* Two bookshelves on the right wall, flanking the lounge */}
      <Bookshelf position={[halfW - wallInset, 0, -4]} rotation={-Math.PI / 2} />
      <Bookshelf position={[halfW - wallInset, 0, 10]} rotation={-Math.PI / 2} />

      {/* Bookshelf on left wall between meeting room and desks */}
      <Bookshelf position={[-halfW + wallInset, 0, 3]} rotation={Math.PI / 2} />

      {/* Potted plants — corners + lounge accents */}
      <PottedPlant position={[halfW - 1, 0, -halfD + 1]} scale={1.2} />
      <PottedPlant position={[-halfW + 1, 0, halfD - 1]} scale={1.4} glow />
      <PottedPlant position={[halfW - 2.5, 0, 8]} scale={1.0} />
      <PottedPlant position={[0, 0, halfD - 1]} scale={1.5} />

      {/* Wall posters on the back wall between desks */}
      <WallPoster
        position={[-10.5, 2.3, -halfD + 0.05]}
        title="MARGOT.EXE"
        subtitle="// LOYALTY_V2 //"
        color="#ff2266"
      />
      <WallPoster
        position={[0, 2.3, -halfD + 0.05]}
        title="NIGHT CITY"
        subtitle="// 2077 //"
        color="#22ccff"
        size={[1.6, 2.0]}
      />
      <WallPoster
        position={[10.5, 2.3, -halfD + 0.05]}
        title="KEEP BUILDING"
        subtitle="// ship > plan //"
        color="#ccff44"
      />

      {/* Poster on left wall */}
      <WallPoster
        position={[-halfW + 0.05, 2.3, -2]}
        rotation={Math.PI / 2}
        title="HARBOR"
        subtitle="// agent workspace //"
        color="#aa44ff"
      />

      {/* Rug under the lounge area */}
      <FloorRug position={[6, 0, 4]} size={[6, 4.5]} color="#2a1a4a" accent="#ff44aa" />

      {/* Rug in front of Margot's desk */}
      <FloorRug position={[-8, 0, -4]} size={[2.8, 2]} color="#2a1a3a" accent="#ff4466" />

      {/* Coffee mugs on a couple desks for that lived-in vibe */}
      <CoffeeMug position={[-8.6, 0.79, -5.5]} color="#ff2244" />
      <CoffeeMug position={[-3.6, 0.79, -5.5]} color="#2266ff" />
      <CoffeeMug position={[7.4, 0.79, -5.5]} color="#9944ff" />

      {/* String lights strung across the lounge area — fairy-light vibe */}
      <StringLights from={[2, 3.3, 1]} to={[10, 3.3, 7]} count={14} color="#ffcc88" />
      <StringLights
        from={[halfW - 0.5, 3.3, -halfD + 0.5]}
        to={[halfW - 0.5, 3.3, halfD - 0.5]}
        count={16}
        color="#ff88cc"
      />
    </group>
  );
}
