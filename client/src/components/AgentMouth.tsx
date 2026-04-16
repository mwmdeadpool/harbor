import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VisemeWeights } from '../audio/VisemeAnalyzer';

interface AgentMouthProps {
  visemes: VisemeWeights;
}

/**
 * Simple mouth rendered as a scaled box mesh.
 *
 * Shape is driven by viseme weights:
 *   silence → thin closed line
 *   aa      → wide open (scaleY ++)
 *   oh      → round (scaleX --, scaleY ++)
 *   ee      → spread (scaleX ++, scaleY --)
 *   ss      → narrow slit
 *
 * All transitions are smoothed via lerp.
 */
const AgentMouth = React.memo(function AgentMouth({ visemes }: AgentMouthProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Base dimensions for the mouth geometry (un-scaled)
  const BASE_WIDTH = 0.1;
  const BASE_HEIGHT = 0.012;
  const BASE_DEPTH = 0.02;

  const LERP_SPEED = 10;

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const { aa, oh, ee, ss, silence } = visemes;

    // Compute target scale factors
    let targetSX = 1;
    let targetSY = 1;

    if (silence > 0.8) {
      // Closed mouth — thin line
      targetSX = 1;
      targetSY = 1;
    } else {
      // Blend viseme contributions
      // aa: jaw open → wider & taller
      targetSX += aa * 0.5;
      targetSY += aa * 4.0;

      // oh: round → narrower & taller
      targetSX -= oh * 0.3;
      targetSY += oh * 3.0;

      // ee: spread → wider & shorter
      targetSX += ee * 0.8;
      targetSY += ee * 1.5;

      // ss: narrow slit
      targetSX -= ss * 0.2;
      targetSY += ss * 1.0;
    }

    // Clamp
    targetSX = Math.max(0.4, Math.min(2.5, targetSX));
    targetSY = Math.max(1.0, Math.min(6.0, targetSY));

    // Smooth lerp
    const t = Math.min(1, delta * LERP_SPEED);
    const curSX = meshRef.current.scale.x;
    const curSY = meshRef.current.scale.y;
    meshRef.current.scale.x = THREE.MathUtils.lerp(curSX, targetSX, t);
    meshRef.current.scale.y = THREE.MathUtils.lerp(curSY, targetSY, t);
  });

  return (
    <mesh ref={meshRef} position={[0, 1.28, 0.2]}>
      <boxGeometry args={[BASE_WIDTH, BASE_HEIGHT, BASE_DEPTH]} />
      <meshStandardMaterial color="#331111" roughness={0.8} />
    </mesh>
  );
});

export { AgentMouth };
export type { AgentMouthProps };
