import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentState } from '../types';
import { getAgentColor } from '../types';
import { SpeakingIndicator } from './SpeakingIndicator';
import { AgentMouth } from './AgentMouth';
import { VRMAvatar } from './VRMAvatar';
import { AGENT_AVATARS } from '../config/avatars';
import type { VisemeWeights } from '../audio/VisemeAnalyzer';

interface Agent3DProps {
  agent: AgentState;
}

export function Agent3D({ agent }: Agent3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const bobOffset = useRef(Math.random() * Math.PI * 2);

  // Smooth animation parameter blending — interpolate between states
  const currentBobSpeed = useRef(1.5);
  const currentBobHeight = useRef(0.05);
  const targetBodyRotZ = useRef(0);
  const targetBodyRotX = useRef(0);
  const targetGlowScale = useRef(0);
  const targetGlowOpacity = useRef(0);

  const color = useMemo(() => getAgentColor(agent.name), [agent.name]);
  const baseColor = useMemo(() => new THREE.Color(color).multiplyScalar(0.6), [color]);

  // Resolve VRM avatar URL: prefer agent.avatar, fall back to config map
  const avatarConfig = useMemo(() => AGENT_AVATARS[agent.name.toLowerCase()], [agent.name]);
  const vrmUrl = agent.avatar || avatarConfig?.vrmUrl || '';
  const hasVRM = vrmUrl.length > 0;

  // Target animation parameters
  const animParams = useMemo(
    () => getActivityAnimation(agent.activity, agent.animation),
    [agent.activity, agent.animation],
  );

  // Smooth transition speed — how fast to blend between animation states
  const BLEND_SPEED = 3;

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Smoothly blend bob parameters instead of snapping
    currentBobSpeed.current = THREE.MathUtils.lerp(
      currentBobSpeed.current,
      animParams.bobSpeed,
      delta * BLEND_SPEED,
    );
    currentBobHeight.current = THREE.MathUtils.lerp(
      currentBobHeight.current,
      animParams.bobHeight,
      delta * BLEND_SPEED,
    );

    bobOffset.current += delta * currentBobSpeed.current;

    // Position with smooth lerp for movement
    const targetX = agent.position.x;
    const targetZ = agent.position.z;
    const currentX = groupRef.current.position.x;
    const currentZ = groupRef.current.position.z;
    groupRef.current.position.x = THREE.MathUtils.lerp(currentX, targetX, delta * 3);
    groupRef.current.position.z = THREE.MathUtils.lerp(currentZ, targetZ, delta * 3);
    groupRef.current.position.y =
      agent.position.y + Math.sin(bobOffset.current) * currentBobHeight.current;

    // Smooth rotation lerp with shortest-path wrapping
    if (agent.rotation !== undefined) {
      const targetRot = agent.rotation;
      let currentRot = groupRef.current.rotation.y;
      // Wrap to find shortest rotation path
      let diff = targetRot - currentRot;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      groupRef.current.rotation.y = currentRot + diff * Math.min(1, delta * 4);
    }

    // Calculate target body rotations based on activity (then blend below)
    if (agent.speaking || agent.activity === 'talking') {
      targetBodyRotZ.current = Math.sin(bobOffset.current * 2.5) * 0.04;
      targetBodyRotX.current = 0;
    } else if (agent.activity === 'working' || agent.activity === 'coding') {
      targetBodyRotZ.current = Math.sin(bobOffset.current * 6) * 0.008;
      targetBodyRotX.current = 0;
    } else if (agent.activity === 'thinking') {
      targetBodyRotZ.current = Math.sin(bobOffset.current * 0.5) * 0.03;
      targetBodyRotX.current = Math.sin(bobOffset.current * 0.3) * 0.02;
    } else if (agent.animation === 'listening') {
      targetBodyRotX.current = -0.05;
      targetBodyRotZ.current = 0;
    } else if (agent.animation === 'wave') {
      targetBodyRotZ.current = Math.sin(bobOffset.current * 4) * 0.06;
      targetBodyRotX.current = 0;
    } else {
      targetBodyRotZ.current = 0;
      targetBodyRotX.current = 0;
    }

    // Smoothly blend body rotations
    if (bodyRef.current) {
      bodyRef.current.rotation.z = THREE.MathUtils.lerp(
        bodyRef.current.rotation.z,
        targetBodyRotZ.current,
        delta * BLEND_SPEED * 2,
      );
      bodyRef.current.rotation.x = THREE.MathUtils.lerp(
        bodyRef.current.rotation.x,
        targetBodyRotX.current,
        delta * BLEND_SPEED * 2,
      );
    }

    // Calculate target glow parameters
    if (agent.speaking || agent.activity === 'presenting') {
      targetGlowScale.current = 0.8 + Math.sin(bobOffset.current * 4) * 0.4;
      targetGlowOpacity.current = 0.15 + Math.sin(bobOffset.current * 4) * 0.1;
    } else if (agent.activity === 'thinking') {
      targetGlowScale.current = 0.5 + Math.sin(bobOffset.current * 1.5) * 0.2;
      targetGlowOpacity.current = 0.08;
    } else {
      targetGlowScale.current = 0;
      targetGlowOpacity.current = 0;
    }

    // Smoothly blend glow
    if (glowRef.current) {
      const currentScale = glowRef.current.scale.x;
      const newScale = THREE.MathUtils.lerp(currentScale, targetGlowScale.current, delta * BLEND_SPEED);
      glowRef.current.scale.setScalar(newScale);
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetGlowOpacity.current, delta * BLEND_SPEED);
    }
  });

  const activityIcon = getActivityIcon(agent.activity, agent.animation);

  // Default viseme weights driven by speaking state.
  // When per-agent audio sources are wired up, replace with useVisemes() output.
  const defaultVisemes: VisemeWeights = agent.speaking
    ? { aa: 0.5, oh: 0, ee: 0, ss: 0, silence: 0 }
    : { aa: 0, oh: 0, ee: 0, ss: 0, silence: 1 };

  return (
    <group ref={groupRef} position={[agent.position.x, agent.position.y, agent.position.z]}>
      <group ref={bodyRef}>
        {hasVRM ? (
          /* VRM avatar model */
          <group
            scale={avatarConfig?.scale ?? 1.0}
            position={avatarConfig?.offset ?? [0, 0, 0]}
          >
            <VRMAvatar url={vrmUrl} animation={agent.animation} speaking={agent.speaking} />
          </group>
        ) : (
          <>
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
                color={baseColor}
                roughness={0.6}
              />
            </mesh>
          </>
        )}
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

      {/* Mouth — viseme-driven lip sync */}
      {!hasVRM && <AgentMouth visemes={defaultVisemes} />}

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
