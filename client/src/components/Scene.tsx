import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { KernelSize } from 'postprocessing';
import { useStore } from '../store';
import { Room, DEFAULT_ROOM } from './Room';
import { Agent3D } from './Agent3D';
import { ConversationLayer } from './ConversationBubble';
import { SystemAmbience } from './SystemAmbience';
import { CameraWall } from './CameraPanel3D';
import { JournalWall } from './JournalWall';
import { MTGTable } from './MTGTable';
import { AgentWorkbenches } from './AgentWorkbench';
import { DenProps } from './DenProps';
import { HeroProps } from './HeroProps';
import type { AgentState } from '../types';

const MemoizedAgent3D = React.memo(Agent3D);

// Default agent positions for demo / when server hasn't sent state
const DEFAULT_AGENTS: Record<string, AgentState> = {
  margot: {
    id: 'margot',
    name: 'Margot',
    avatar: '',
    position: { x: -8, y: 0, z: -4 },
    rotation: 0,
    zone: 'desk-margot',
    activity: 'thinking',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'focused',
  },
  bud: {
    id: 'bud',
    name: 'Bud',
    avatar: '',
    position: { x: -3, y: 0, z: -4 },
    rotation: 0,
    zone: 'desk-bud',
    activity: 'monitoring',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'chill',
  },
  lou: {
    id: 'lou',
    name: 'Lou',
    avatar: '',
    position: { x: 2, y: 0, z: -4 },
    rotation: 0,
    zone: 'desk-lou',
    activity: 'researching',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'happy',
  },
  nygma: {
    id: 'nygma',
    name: 'Nygma',
    avatar: '',
    position: { x: 7, y: 0, z: -4 },
    rotation: 0,
    zone: 'desk-nygma',
    activity: 'scanning',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'thinking',
  },
  ivy: {
    id: 'ivy',
    name: 'Ivy',
    avatar: '',
    position: { x: -8, y: 0, z: 1 },
    rotation: 0,
    zone: 'desk-ivy',
    activity: 'coding',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'focused',
  },
  harvey: {
    id: 'harvey',
    name: 'Harvey',
    avatar: '',
    position: { x: -3, y: 0, z: 1 },
    rotation: 0,
    zone: 'desk-harvey',
    activity: 'testing',
    animation: 'idle',
    speaking: false,
    lastActive: Date.now(),
    mood: 'neutral',
  },
};

export function Scene() {
  const worldState = useStore((s) => s.worldState);
  const agentConversations = useStore((s) => s.agentConversations);
  const agents = worldState?.agents ?? DEFAULT_AGENTS;
  const room = worldState?.room ?? DEFAULT_ROOM;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        camera={{
          position: [12, 18, 20],
          fov: 45,
          near: 0.1,
          far: 200,
        }}
        shadows
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#050510' }}
      >
        {/* System-state ambience (replaces static lights — health-driven color) */}
        <SystemAmbience />

        {/* Fog for depth — pushed back so stars read before the fade. */}
        <fog attach="fog" args={['#0a0a1e', 40, 90]} />

        {/* Starfield behind the walls — fills the void with something to
            orbit around. Large radius so it reads as distant sky. */}
        <Stars radius={100} depth={50} count={4000} factor={4} saturation={0.2} fade speed={0.5} />

        {/* Room geometry */}
        <Room config={room} />

        {/* Dev-den furniture — bookshelves, plants, posters, rugs, lights */}
        <DenProps width={room.width} depth={room.depth} />

        {/* Hero props — arcade, server rack, pool table, sofa (GLB) */}
        <HeroProps />

        {/* Phase 5 — workspace furniture */}
        <CameraWall />
        <JournalWall />
        <MTGTable position={[10, 0, 8]} />
        <AgentWorkbenches />

        {/* Agent avatars */}
        {Object.values(agents).map((agent) => (
          <MemoizedAgent3D key={agent.id} agent={agent} />
        ))}

        {/* Inter-agent conversation bubbles */}
        <ConversationLayer conversations={agentConversations} agents={agents} />

        {/* Camera controls */}
        <OrbitControls
          target={[0, 1, 0]}
          minDistance={5}
          maxDistance={40}
          maxPolarAngle={Math.PI / 2.1}
          enablePan={true}
          panSpeed={0.8}
          rotateSpeed={0.5}
          zoomSpeed={0.8}
        />

        {/* Post-processing — bloom makes all the emissive neon actually glow. */}
        <EffectComposer>
          <Bloom
            intensity={0.9}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.3}
            kernelSize={KernelSize.LARGE}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.15} darkness={0.6} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
