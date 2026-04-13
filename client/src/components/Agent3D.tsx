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
  const bobOffset = useRef(Math.random() * Math.PI * 2);

  const color = useMemo(() => getAgentColor(agent.name), [agent.name]);

  // Activity-based animation parameters
  const animParams = useMemo(
    () => getActivityAnimation(agent.activity, agent.animation),
    [agent.activity, agent.animation],
  );

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    bobOffset.current += delta * animParams.bobSpeed;

    // Position with smooth lerp for movement
    const targetX = agent.position.x;
    const targetZ = agent.position.z;
    const currentX = groupRef.current.position.x;
    const currentZ = groupRef.current.position.z;
    groupRef.current.position.x = THREE.MathUtils.lerp(currentX, targetX, delta * 3);
    groupRef.current.position.z = THREE.MathUtils.lerp(currentZ, targetZ, delta * 3);
    groupRef.current.position.y =
      agent.position.y + Math.sin(bobOffset.current) * animParams.bobHeight;

    // Smooth rotation lerp
    if (agent.rotation !== undefined) {
      const targetRot = agent.rotation;
      const currentRot = groupRef.current.rotation.y;
      groupRef.current.rotation.y = THREE.MathUtils.lerp(currentRot, targetRot, delta * 4);
    }

    // Body animation based on activity
    if (bodyRef.current) {
      if (agent.speaking || agent.activity === 'talking') {
        // Speaking sway
        const sway = Math.sin(bobOffset.current * 2.5) * 0.04;
        bodyRef.current.rotation.z = sway;
      } else if (agent.activity === 'working' || agent.activity === 'coding') {
        // Subtle typing motion
        const typing = Math.sin(bobOffset.current * 6) * 0.008;
        bodyRef.current.rotation.z = typing;
      } else if (agent.activity === 'thinking') {
        // Slow tilt
        const think = Math.sin(bobOffset.current * 0.5) * 0.03;
        bodyRef.current.rotation.z = think;
        bodyRef.current.rotation.x = Math.sin(bobOffset.current * 0.3) * 0.02;
      } else if (agent.animation === 'listening') {
        // Slight lean forward
        bodyRef.current.rotation.x = -0.05;
        bodyRef.current.rotation.z *= 0.95;
      } else if (agent.animation === 'wave') {
        // Wave animation — body tilt
        const wave = Math.sin(bobOffset.current * 4) * 0.06;
        bodyRef.current.rotation.z = wave;
      } else {
        // Ease back to neutral
        bodyRef.current.rotation.z *= 0.9;
        bodyRef.current.rotation.x *= 0.9;
      }
    }

    // Glow pulse for speaking/presenting
    if (glowRef.current) {
      if (agent.speaking || agent.activity === 'presenting') {
        const pulse = 0.8 + Math.sin(bobOffset.current * 4) * 0.4;
        glowRef.current.scale.setScalar(pulse);
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
          0.15 + Math.sin(bobOffset.current * 4) * 0.1;
      } else if (agent.activity === 'thinking') {
        // Gentle thinking glow
        const pulse = 0.5 + Math.sin(bobOffset.current * 1.5) * 0.2;
        glowRef.current.scale.setScalar(pulse);
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.08;
      } else {
        glowRef.current.scale.setScalar(0);
      }
    }
  });

  const activityIcon = getActivityIcon(agent.activity, agent.animation);

  return (
    <group ref={groupRef} position={[agent.position.x, agent.position.y, agent.position.z]}>
      <group ref={bodyRef}>
        {/* Body — capsule shape */}
        <mesh position={[0, 0.7, 0]} castShadow>
          <cylinderGeometry args={[0.25, 0.3, 0.8, 16]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
        </mesh>

        {/* Head */}
        <mesh position={[0, 1.35, 0]} castShadow>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
        </mesh>

        {/* Neck */}
        <mesh position={[0, 1.1, 0]}>
          <cylinderGeometry args={[0.1, 0.15, 0.1, 8]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>

        {/* Base */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.3, 0.35, 0.3, 16]} />
          <meshStandardMaterial
            color={new THREE.Color(color).multiplyScalar(0.6)}
            roughness={0.6}
          />
        </mesh>
      </group>

      {/* Speaking/thinking glow ring */}
      <mesh ref={glowRef} position={[0, 0.7, 0]} scale={0}>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>

      {/* Eyes */}
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

      {/* Name label */}
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

      {/* Activity indicator with icon */}
      <Html
        position={[0, 2.15, 0]}
        center
        style={{ pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }}
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
          {activityIcon} {agent.animation !== 'idle' ? agent.animation : agent.activity}
        </div>
      </Html>

      {/* Speaking indicator */}
      <SpeakingIndicator agentName={agent.name} visible={agent.speaking} />

      {/* Mood ring */}
      {agent.mood && agent.mood !== 'neutral' && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.35, 0.45, 24]} />
          <meshBasicMaterial color={getMoodColor(agent.mood)} transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  );
}

interface ActivityAnimParams {
  bobSpeed: number;
  bobHeight: number;
}

function getActivityAnimation(activity: string, animation: string): ActivityAnimParams {
  if (animation === 'wave') return { bobSpeed: 3, bobHeight: 0.08 };
  if (animation === 'listening') return { bobSpeed: 1.0, bobHeight: 0.02 };

  switch (activity) {
    case 'talking':
      return { bobSpeed: 2.0, bobHeight: 0.06 };
    case 'working':
    case 'coding':
      return { bobSpeed: 1.2, bobHeight: 0.02 };
    case 'thinking':
      return { bobSpeed: 0.8, bobHeight: 0.04 };
    case 'presenting':
      return { bobSpeed: 1.8, bobHeight: 0.07 };
    case 'away':
      return { bobSpeed: 0.5, bobHeight: 0.01 };
    default:
      return { bobSpeed: 1.5, bobHeight: 0.05 };
  }
}

function getActivityIcon(activity: string, animation: string): string {
  if (animation === 'wave') return '\u{1F44B}';
  if (animation === 'listening') return '\u{1F442}';

  switch (activity) {
    case 'talking':
      return '\u{1F4AC}';
    case 'working':
      return '\u{2328}';
    case 'coding':
      return '\u{1F4BB}';
    case 'thinking':
      return '\u{1F4AD}';
    case 'presenting':
      return '\u{1F4CA}';
    case 'away':
      return '\u{1F4A4}';
    default:
      return '\u{26AB}';
  }
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
    case 'attentive':
      return '#44ccff';
    case 'stressed':
      return '#ff4444';
    case 'chill':
      return '#44dddd';
    case 'playful':
      return '#ff66aa';
    case 'steady':
      return '#4466cc';
    case 'curious':
      return '#66cc44';
    case 'analytical':
      return '#8888aa';
    case 'serene':
      return '#ff9944';
    default:
      return '#888888';
  }
}
