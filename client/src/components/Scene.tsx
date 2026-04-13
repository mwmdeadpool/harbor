import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useStore } from '../store';
import { Room, DEFAULT_ROOM } from './Room';
import { Agent3D } from './Agent3D';
import type { AgentState } from '../types';

// Default agent positions for demo / when server hasn't sent state
const DEFAULT_AGENTS: Record<string, AgentState> = {
  margot: {
    id: 'margot', name: 'Margot', avatar: '', position: { x: -8, y: 0, z: -4 },
    rotation: 0, zone: 'desk-margot', activity: 'thinking', animation: 'idle',
    speaking: false, lastActive: Date.now(), mood: 'focused',
  },
  bud: {
    id: 'bud', name: 'Bud', avatar: '', position: { x: -3, y: 0, z: -4 },
    rotation: 0, zone: 'desk-bud', activity: 'monitoring', animation: 'idle',
    speaking: false, lastActive: Date.now(), mood: 'chill',
  },
  lou: {
    id: 'lou', name: 'Lou', avatar: '', position: { x: 2, y: 0, z: -4 },
    rotation: 0, zone: 'desk-lou', activity: 'researching', animation: 'idle',
    speaking: false, lastActive: Date.now(), mood: 'happy',
  },
  nygma: {
    id: 'nygma', name: 'Nygma', avatar: '', position: { x: 7, y: 0, z: -4 },
    rotation: 0, zone: 'desk-nygma', activity: 'scanning', animation: 'idle',
    speaking: false, lastActive: Date.now(), mood: 'thinking',
  },
  ivy: {
    id: 'ivy', name: 'Ivy', avatar: '', position: { x: -8, y: 0, z: 1 },
    rotation: 0, zone: 'desk-ivy', activity: 'coding', animation: 'idle',
    speaking: false, lastActive: Date.now(), mood: 'focused',
  },
  harvey: {
    id: 'harvey', name: 'Harvey', avatar: '', position: { x: -3, y: 0, z: 1 },
    rotation: 0, zone: 'desk-harvey', activity: 'testing', animation: 'idle',
    speaking: false, lastActive: Date.now(), mood: 'neutral',
  },
};

export function Scene() {
  const worldState = useStore((s) => s.worldState);
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
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#1a1a2e' }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} color="#8888cc" />
        <directionalLight
          position={[10, 15, 8]}
          intensity={0.8}
          color="#ffffff"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={50}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <directionalLight position={[-5, 8, -5]} intensity={0.2} color="#6644aa" />

        {/* Fog for depth */}
        <fog attach="fog" args={['#1a1a2e', 25, 60]} />

        {/* Room geometry */}
        <Room config={room} />

        {/* Agent avatars */}
        {Object.values(agents).map((agent) => (
          <Agent3D key={agent.id} agent={agent} />
        ))}

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
      </Canvas>
    </div>
  );
}
