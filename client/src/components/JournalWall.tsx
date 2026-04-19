import React, { useMemo } from 'react';
import { Text } from '@react-three/drei';
import { usePanelData } from '../hooks/usePanelData';

interface JournalEntry {
  id: string;
  timestamp: string;
  title: string;
  preview: string;
}

interface JournalResponse {
  entries: JournalEntry[];
}

interface TileProps {
  entry: JournalEntry;
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
  height?: number;
  tint?: string;
}

const JournalTile = React.memo(function JournalTile({
  entry,
  position,
  rotation = [0, 0, 0],
  width = 2.6,
  height = 2.0,
  tint = '#2a2a40',
}: TileProps) {
  return (
    <group position={position} rotation={rotation}>
      {/* Frame */}
      <mesh>
        <boxGeometry args={[width + 0.1, height + 0.1, 0.04]} />
        <meshStandardMaterial color="#0e0e18" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Paper face */}
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={tint} metalness={0.05} roughness={0.9} />
      </mesh>
      {/* Timestamp */}
      <Text
        position={[-(width / 2) + 0.15, height / 2 - 0.15, 0.04]}
        fontSize={0.095}
        color="#88aacc"
        anchorX="left"
        anchorY="top"
        maxWidth={width - 0.3}
      >
        {entry.timestamp}
      </Text>
      {/* Title */}
      <Text
        position={[-(width / 2) + 0.15, height / 2 - 0.36, 0.04]}
        fontSize={0.15}
        color="#ffffff"
        anchorX="left"
        anchorY="top"
        maxWidth={width - 0.3}
      >
        {entry.title}
      </Text>
      {/* Preview */}
      <Text
        position={[-(width / 2) + 0.15, height / 2 - 0.7, 0.04]}
        fontSize={0.085}
        color="#ccccdd"
        anchorX="left"
        anchorY="top"
        maxWidth={width - 0.3}
        lineHeight={1.3}
      >
        {entry.preview.length > 220 ? entry.preview.slice(0, 217) + '...' : entry.preview}
      </Text>
    </group>
  );
});

const TILE_TINTS = ['#2a2a40', '#2b2438', '#24303f', '#2f2a3e', '#283545', '#302838'];

export function JournalWall() {
  const { data } = usePanelData<JournalResponse>('/api/panel/journal?limit=6', {
    intervalMs: 120_000,
  });
  const entries = data?.entries || [];

  // Mount on left wall (x = -14.85) facing inward (rotation Y = π/2). Stacked 3x2.
  const wallX = -14.85;
  const rotation: [number, number, number] = [0, Math.PI / 2, 0];
  const tileWidth = 2.6;
  const tileHeight = 2.0;
  const gap = 0.2;

  const tiles = useMemo(() => {
    return entries.slice(0, 6).map((entry, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      // z-axis becomes horizontal along the wall; negative z is "left" as viewed from center
      const z = (col - 1) * (tileWidth + gap);
      const y = 3.4 - row * (tileHeight + gap);
      return {
        entry,
        position: [wallX, y, z] as [number, number, number],
        tint: TILE_TINTS[i % TILE_TINTS.length],
      };
    });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <group>
        {/* Placeholder plaque while loading */}
        <Text
          position={[wallX + 0.1, 2.5, 0]}
          rotation={rotation}
          fontSize={0.2}
          color="#66668a"
          anchorX="center"
          anchorY="middle"
        >
          journal loading…
        </Text>
      </group>
    );
  }

  return (
    <group>
      {tiles.map(({ entry, position, tint }) => (
        <JournalTile
          key={entry.id}
          entry={entry}
          position={position}
          rotation={rotation}
          tint={tint}
        />
      ))}
    </group>
  );
}
