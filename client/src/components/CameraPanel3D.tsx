import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { usePanelImage } from '../hooks/usePanelData';

interface Props {
  camera: string;
  label: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
  height?: number;
}

export const CameraPanel3D = React.memo(function CameraPanel3D({
  camera,
  label,
  position,
  rotation = [0, 0, 0],
  width = 3.2,
  height = 1.8,
}: Props) {
  const { url, error } = usePanelImage(
    `/api/panel/camera?camera=${encodeURIComponent(camera)}`,
    5_000,
  );
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setTexture((prev) => {
        prev?.dispose();
        return tex;
      });
    };
    img.src = url;
  }, [url]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0a0a14', metalness: 0.55, roughness: 0.35 }),
    [],
  );

  return (
    <group position={position} rotation={rotation}>
      {/* Frame */}
      <mesh material={frameMaterial}>
        <boxGeometry args={[width + 0.14, height + 0.14, 0.06]} />
      </mesh>
      {/* Screen */}
      <mesh position={[0, 0, 0.04]}>
        <planeGeometry args={[width, height]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : (
          <meshStandardMaterial
            color={error ? '#441111' : '#111122'}
            emissive={error ? '#441111' : '#111122'}
            emissiveIntensity={0.4}
          />
        )}
      </mesh>
      {/* Corner indicator — red when errored, cyan when live */}
      <mesh position={[width / 2 - 0.1, height / 2 - 0.1, 0.06]}>
        <circleGeometry args={[0.035, 16]} />
        <meshStandardMaterial
          color={error ? '#ff3344' : '#33ddff'}
          emissive={error ? '#ff3344' : '#33ddff'}
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      {/* Label */}
      <Text
        position={[0, -(height / 2) - 0.18, 0.06]}
        fontSize={0.12}
        color="#aaaacc"
        anchorX="center"
        anchorY="middle"
      >
        {label.toUpperCase()}
      </Text>
    </group>
  );
});

interface WallProps {
  cameras?: Array<{ id: string; label: string }>;
}

const DEFAULT_CAMERAS: Array<{ id: string; label: string }> = [
  { id: 'front_door_bell', label: 'Front Door' },
  { id: 'pool_camera', label: 'Pool' },
  { id: 'play_room_camera', label: 'Play Room' },
  { id: 'living_room_camera', label: 'Living Room' },
];

export function CameraWall({ cameras = DEFAULT_CAMERAS }: WallProps) {
  // Mount on the back wall (z = -15 for 30x30 room). Spaced horizontally.
  const wallZ = -14.85;
  const wallY = 4.2;
  const spacing = 4.0;
  const startX = -((cameras.length - 1) / 2) * spacing;

  return (
    <group>
      {cameras.map((cam, i) => (
        <CameraPanel3D
          key={cam.id}
          camera={cam.id}
          label={cam.label}
          position={[startX + i * spacing, wallY, wallZ]}
        />
      ))}
    </group>
  );
}
