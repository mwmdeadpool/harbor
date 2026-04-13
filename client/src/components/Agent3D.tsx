import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentState } from '../types';
import { getAgentColor } from '../types';

interface Agent3DProps {
  agent: AgentState;
}

export function Agent3D({ agent }: Agent3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const bobOffset = useRef(Math.random() * Math.PI * 2); // random phase so agents don't bob in sync

  const color = useMemo(() => getAgentColor(agent.name), [agent.name]);
  const colorObj = useMemo(() => new THREE.Color(color), [color]);

  // Idle bob + speaking glow animation
  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Gentle bob
    bobOffset.current += delta * 1.5;
    const bobY = Math.sin(bobOffset.current) * 0.05;
    groupRef.current.position.y = agent.position.y + bobY;
    groupRef.current.position.x = agent.position.x;
    groupRef.current.position.z = agent.position.z;

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
    <group
      ref={groupRef}
      position={[agent.position.x, agent.position.y, agent.position.z]}
    >
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

      {/* Speaking glow ring */}
      <mesh ref={glowRef} position={[0, 0.7, 0]} scale={0}>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.15}
          side={THREE.BackSide}
        />
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

      {/* Speaking indicator */}
      {agent.speaking && (
        <Html position={[0.4, 1.5, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: colorObj.getStyle(),
              boxShadow: `0 0 8px ${color}, 0 0 16px ${color}88`,
              animation: 'pulse 0.6s ease-in-out infinite alternate',
            }}
          />
          <style>{`
            @keyframes pulse {
              from { transform: scale(0.8); opacity: 0.6; }
              to { transform: scale(1.3); opacity: 1; }
            }
          `}</style>
        </Html>
      )}

      {/* Mood ring at the base */}
      {agent.mood && agent.mood !== 'neutral' && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.35, 0.45, 24]} />
          <meshBasicMaterial
            color={getMoodColor(agent.mood)}
            transparent
            opacity={0.4}
          />
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
