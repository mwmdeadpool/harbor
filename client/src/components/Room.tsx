import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { RoomConfig, Zone } from '../types';

// Default room config when server hasn't sent one yet
export const DEFAULT_ROOM: RoomConfig = {
  width: 30,
  depth: 30,
  zones: [
    { id: 'desk-margot', name: 'Margot', type: 'desk', position: { x: -8, y: 0, z: -6 }, size: { width: 3, depth: 2 } },
    { id: 'desk-bud', name: 'Bud', type: 'desk', position: { x: -3, y: 0, z: -6 }, size: { width: 3, depth: 2 } },
    { id: 'desk-lou', name: 'Lou', type: 'desk', position: { x: 2, y: 0, z: -6 }, size: { width: 3, depth: 2 } },
    { id: 'desk-nygma', name: 'Nygma', type: 'desk', position: { x: 7, y: 0, z: -6 }, size: { width: 3, depth: 2 } },
    { id: 'desk-ivy', name: 'Ivy', type: 'desk', position: { x: -8, y: 0, z: -1 }, size: { width: 3, depth: 2 } },
    { id: 'desk-harvey', name: 'Harvey', type: 'desk', position: { x: -3, y: 0, z: -1 }, size: { width: 3, depth: 2 } },
    { id: 'lounge', name: 'Lounge', type: 'lounge', position: { x: 6, y: 0, z: 4 }, size: { width: 8, depth: 6 }, color: '#1e2d40' },
    { id: 'meeting', name: 'Meeting Room', type: 'meeting', position: { x: -6, y: 0, z: 6 }, size: { width: 7, depth: 5 }, color: '#2d1e40' },
  ],
};

function FloorGrid({ width, depth }: { width: number; depth: number }) {
  return (
    <group>
      {/* Main floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      {/* Grid lines */}
      <gridHelper
        args={[width, width, '#2a2a4e', '#222240']}
        position={[0, 0, 0]}
      />
    </group>
  );
}

function WallOutlines({ width, depth }: { width: number; depth: number }) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallHeight = 3;

  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2a2a4e',
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      }),
    []
  );

  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, wallHeight / 2, -halfD]} material={wallMaterial}>
        <planeGeometry args={[width, wallHeight]} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-halfW, wallHeight / 2, 0]} rotation-y={Math.PI / 2} material={wallMaterial}>
        <planeGeometry args={[depth, wallHeight]} />
      </mesh>
      {/* Right wall */}
      <mesh position={[halfW, wallHeight / 2, 0]} rotation-y={-Math.PI / 2} material={wallMaterial}>
        <planeGeometry args={[depth, wallHeight]} />
      </mesh>
      {/* Wall edge lines */}
      {[
        [[-halfW, 0, -halfD], [halfW, 0, -halfD]],
        [[-halfW, 0, -halfD], [-halfW, 0, halfD]],
        [[halfW, 0, -halfD], [halfW, 0, halfD]],
        [[-halfW, wallHeight, -halfD], [halfW, wallHeight, -halfD]],
        [[-halfW, 0, -halfD], [-halfW, wallHeight, -halfD]],
        [[halfW, 0, -halfD], [halfW, wallHeight, -halfD]],
      ].map(([start, end], i) => {
        const points = [
          new THREE.Vector3(start[0], start[1], start[2]),
          new THREE.Vector3(end[0], end[1], end[2]),
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <lineSegments key={i} geometry={geometry}>
            <lineBasicMaterial color="#4a4a6e" />
          </lineSegments>
        );
      })}
    </group>
  );
}

function Desk({ zone }: { zone: Zone }) {
  const { position, size, name } = zone;
  const deskHeight = 0.75;
  const deskThickness = 0.05;

  return (
    <group position={[position.x, 0, position.z]}>
      {/* Desk surface */}
      <mesh position={[0, deskHeight, 0]}>
        <boxGeometry args={[size.width, deskThickness, size.depth]} />
        <meshStandardMaterial color="#2a3040" />
      </mesh>
      {/* Legs */}
      {[
        [-(size.width / 2 - 0.1), deskHeight / 2, -(size.depth / 2 - 0.1)],
        [(size.width / 2 - 0.1), deskHeight / 2, -(size.depth / 2 - 0.1)],
        [-(size.width / 2 - 0.1), deskHeight / 2, (size.depth / 2 - 0.1)],
        [(size.width / 2 - 0.1), deskHeight / 2, (size.depth / 2 - 0.1)],
      ].map(([lx, ly, lz], i) => (
        <mesh key={i} position={[lx, ly, lz]}>
          <boxGeometry args={[0.08, deskHeight, 0.08]} />
          <meshStandardMaterial color="#1e2530" />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, deskHeight + 0.35, -(size.depth / 2 - 0.15)]}>
        <boxGeometry args={[0.8, 0.5, 0.04]} />
        <meshStandardMaterial color="#111118" emissive="#1a1a3e" emissiveIntensity={0.5} />
      </mesh>
      {/* Name label */}
      <Text
        position={[0, 2.2, 0]}
        fontSize={0.3}
        color="#666688"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </group>
  );
}

function ZoneFloor({ zone }: { zone: Zone }) {
  const color = zone.color || (zone.type === 'lounge' ? '#1e2d40' : '#2d1e40');
  return (
    <group position={[zone.position.x, 0.005, zone.position.z]}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[zone.size.width, zone.size.depth]} />
        <meshStandardMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <Text
        position={[0, 0.01, 0]}
        rotation-x={-Math.PI / 2}
        fontSize={0.4}
        color="#555577"
        anchorX="center"
        anchorY="middle"
      >
        {zone.name}
      </Text>
    </group>
  );
}

interface RoomProps {
  config?: RoomConfig;
}

export function Room({ config }: RoomProps) {
  const room = config || DEFAULT_ROOM;
  const desks = room.zones.filter((z) => z.type === 'desk');
  const areas = room.zones.filter((z) => z.type === 'lounge' || z.type === 'meeting');

  return (
    <group>
      <FloorGrid width={room.width} depth={room.depth} />
      <WallOutlines width={room.width} depth={room.depth} />
      {desks.map((z) => (
        <Desk key={z.id} zone={z} />
      ))}
      {areas.map((z) => (
        <ZoneFloor key={z.id} zone={z} />
      ))}
    </group>
  );
}
