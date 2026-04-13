import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentState } from '../types';
import { getAgentColor } from '../types';
import { SpeakingIndicator } from './SpeakingIndicator';

interface Agent3DProps {
  agent: AgentState;
}

export function Agent3D({ agent }: Agent3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const bobOffset = useRef(Math.random() * Math.PI * 2); // random phase so agents don't bob in sync

  const color = useMemo(() => getAgentColor(agent.name), [agent.name]);
  // Idle bob + speaking glow animation
  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Gentle bob
    bobOffset.current += delta * 1.5;
    const bobY = Math.sin(bobOffset.current) * 0.05;
    groupRef.current.position.y = agent.position.y + bobY;
    groupRef.current.position.x = agent.position.x;
    groupRef.current.position.z = agent.position.z;

    // Speaking body sway
    if (bodyRef.current) {
      if (agent.speaking) {
        const sway = Math.sin(bobOffset.current * 2.5) * 0.03;
        bodyRef.current.rotation.z = sway;
      } else {
        bodyRef.current.rotation.z *= 0.9; // ease back to neutral
      }
    }

    // Speaking glow pulse
    if (glowRef.current) {
      if (agent.speaking) {
        const pulse = 0.8 + Math.sin(bobOffset.current * 4) * 0.4;
        glowRef.current.scale.setScalar(pulse);
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
          0.15 + Math.sin(bobOffset.current * 4) * 0.1;
      } else {
        glowRef.current.scale.setScalar(0);
      }
    }
  });

  return (
    <group ref={groupRef} position={[agent.position.x, agent.position.y, agent.position.z]}>
      <group ref={bodyRef}>
        {/* Body — capsule shape using cylinder + two spheres */}
        <mesh position={[0, 0.7, 0]} castShadow>
          <cylinderGeometry args={[0.25, 0.3, 0.8, 16]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
        </mesh>

        {/* Head — sphere */}
        <mesh position={[0, 1.35, 0]} castShadow>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
        </mesh>

        {/* Neck connector */}
        <mesh position={[0, 1.1, 0]}>
          <cylinderGeometry args={[0.1, 0.15, 0.1, 8]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>

        {/* Base/feet */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.3, 0.35, 0.3, 16]} />
          <meshStandardMaterial
            color={new THREE.Color(color).multiplyScalar(0.6)}
            roughness={0.6}
          />
        </mesh>
      </group>

      {/* Speaking glow ring */}
      <mesh ref={glowRef} position={[0, 0.7, 0]} scale={0}>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>

      {/* Eye dots — give them a face */}
      <mesh position={[-0.08, 1.38, 0.19]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.08, 1.38, 0.19]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* Pupils */}
      <mesh position={[-0.08, 1.38, 0.22]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshBasicMaterial color="#111111" />
      </mesh>
      <mesh position={[0.08, 1.38, 0.22]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshBasicMaterial color="#111111" />
      </mesh>

      {/* Name label — floating above */}
      <Text
        position={[0, 1.85, 0]}
        fontSize={0.22}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#000000"
      >
        {agent.name}
      </Text>

      {/* Activity indicator */}
      {agent.activity && (
        <Html
          position={[0, 2.15, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <div
            style={{
              background: 'rgba(20, 20, 40, 0.85)',
              border: `1px solid ${color}44`,
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              color: '#aaaacc',
              fontFamily: 'monospace',
            }}
          >
            {agent.activity}
          </div>
        </Html>
      )}

      {/* Speaking indicator — animated sound wave bars */}
      <SpeakingIndicator agentName={agent.name} visible={agent.speaking} />

      {/* Mood ring at the base */}
      {agent.mood && agent.mood !== 'neutral' && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.35, 0.45, 24]} />
          <meshBasicMaterial color={getMoodColor(agent.mood)} transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  );
}

function getMoodColor(mood: string): string {
  switch (mood) {
    case 'happy':
      return '#44ff44';
    case 'focused':
      return '#4488ff';
    case 'excited':
      return '#ffcc00';
    case 'thinking':
      return '#aa88ff';
    case 'stressed':
      return '#ff4444';
    case 'chill':
      return '#44dddd';
    default:
      return '#888888';
  }
}
