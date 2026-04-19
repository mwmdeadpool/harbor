import React, { useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { useStore } from '../store';
import { usePanelData } from '../hooks/usePanelData';

interface ScryfallCard {
  id: string;
  name: string;
  type: string;
  cost: string;
  image: string;
}

interface ScryfallResponse {
  cards: ScryfallCard[];
}

interface CardMeshProps {
  card: ScryfallCard;
  position: [number, number, number];
  rotation?: [number, number, number];
}

const CARD_WIDTH = 0.4;
const CARD_HEIGHT = 0.56;

const CardMesh = React.memo(function CardMesh({
  card,
  position,
  rotation = [-Math.PI / 2, 0, 0],
}: CardMeshProps) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const token = useStore((s) => s.token);

  useEffect(() => {
    if (!card.image) return;
    let disposed = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    // Scryfall images are public CDN — no auth needed
    loader.load(
      card.image,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture((prev) => {
          prev?.dispose();
          return tex;
        });
      },
      undefined,
      () => {
        // swallow error, fall back to blank face
      },
    );
    return () => {
      disposed = true;
    };
    // token unused for public scryfall images, but keep deps honest
    void token;
  }, [card.image, token]);

  useEffect(
    () => () => {
      texture?.dispose();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <group position={position} rotation={rotation}>
      {/* Card back (slight thickness) */}
      <mesh position={[0, 0, -0.001]}>
        <boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, 0.002]} />
        <meshStandardMaterial color="#0b0b1a" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Front face */}
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[CARD_WIDTH - 0.02, CARD_HEIGHT - 0.02]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : (
          <meshStandardMaterial color="#1a1a2e" />
        )}
      </mesh>
    </group>
  );
});

interface MTGTableProps {
  position?: [number, number, number];
}

export function MTGTable({ position = [10, 0, 8] }: MTGTableProps) {
  // Query chosen so the table looks good on load. Rotates through flavors.
  const queries = useMemo(
    () => ['t:planeswalker', 't:dragon', 't:angel', 't:demon', 'set:dsk is:commander'],
    [],
  );
  const [queryIdx, setQueryIdx] = useState(0);
  const query = queries[queryIdx];

  useEffect(() => {
    const id = setInterval(() => setQueryIdx((i) => (i + 1) % queries.length), 300_000);
    return () => clearInterval(id);
  }, [queries.length]);

  const { data } = usePanelData<ScryfallResponse>(
    `/api/panel/scryfall?q=${encodeURIComponent(query)}`,
    { intervalMs: 300_000 },
  );
  const cards = data?.cards || [];

  const tableWidth = 2.8;
  const tableDepth = 1.6;
  const tableHeight = 0.75;

  // Layout: up to 12 cards in a 4×3 grid on the tabletop
  const cols = 4;
  const rows = 3;
  const slotW = tableWidth / (cols + 1);
  const slotD = tableDepth / (rows + 1);

  return (
    <group position={position}>
      {/* Tabletop */}
      <mesh position={[0, tableHeight, 0]} castShadow receiveShadow>
        <boxGeometry args={[tableWidth, 0.06, tableDepth]} />
        <meshStandardMaterial color="#3a2a1a" metalness={0.2} roughness={0.8} />
      </mesh>
      {/* Table edge accent */}
      <mesh position={[0, tableHeight + 0.032, 0]}>
        <boxGeometry args={[tableWidth + 0.04, 0.004, tableDepth + 0.04]} />
        <meshStandardMaterial
          color="#8844aa"
          emissive="#8844aa"
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>
      {/* Four legs */}
      {[
        [tableWidth / 2 - 0.08, 0, tableDepth / 2 - 0.08],
        [-(tableWidth / 2 - 0.08), 0, tableDepth / 2 - 0.08],
        [tableWidth / 2 - 0.08, 0, -(tableDepth / 2 - 0.08)],
        [-(tableWidth / 2 - 0.08), 0, -(tableDepth / 2 - 0.08)],
      ].map(([x, , z], i) => (
        <mesh key={i} position={[x, tableHeight / 2, z]}>
          <boxGeometry args={[0.08, tableHeight, 0.08]} />
          <meshStandardMaterial color="#1a1018" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {/* Cards */}
      {cards.slice(0, cols * rows).map((card, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = (col - (cols - 1) / 2) * slotW;
        const z = (row - (rows - 1) / 2) * slotD;
        return <CardMesh key={card.id} card={card} position={[x, tableHeight + 0.035, z]} />;
      })}
      {/* Query label */}
      <Text
        position={[0, tableHeight + 0.03, -(tableDepth / 2) - 0.08]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.08}
        color="#ccaaff"
        anchorX="center"
        anchorY="middle"
      >
        {query}
      </Text>
    </group>
  );
}
