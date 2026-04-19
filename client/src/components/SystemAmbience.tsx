import React, { useMemo } from 'react';
import { usePanelData } from '../hooks/usePanelData';

type HealthLevel = 'healthy' | 'warn' | 'critical';

interface HealthResponse {
  level: HealthLevel;
  notes: string;
  quiet: boolean;
}

const PALETTE: Record<
  HealthLevel,
  { ambient: string; ambientIntensity: number; keyLight: string; fill: string }
> = {
  healthy: {
    ambient: '#8888cc',
    ambientIntensity: 0.4,
    keyLight: '#ffffff',
    fill: '#6644aa',
  },
  warn: {
    ambient: '#ccaa66',
    ambientIntensity: 0.45,
    keyLight: '#ffe0a0',
    fill: '#aa8844',
  },
  critical: {
    ambient: '#cc4444',
    ambientIntensity: 0.55,
    keyLight: '#ffaaaa',
    fill: '#aa2222',
  },
};

export const SystemAmbience = React.memo(function SystemAmbience() {
  const { data } = usePanelData<HealthResponse>('/api/panel/health', { intervalMs: 60_000 });
  const level: HealthLevel = data?.level || 'healthy';
  const palette = useMemo(() => PALETTE[level], [level]);

  return (
    <group>
      <ambientLight intensity={palette.ambientIntensity} color={palette.ambient} />
      <directionalLight
        position={[10, 15, 8]}
        intensity={0.8}
        color={palette.keyLight}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <directionalLight position={[-5, 8, -5]} intensity={0.2} color={palette.fill} />
    </group>
  );
});
