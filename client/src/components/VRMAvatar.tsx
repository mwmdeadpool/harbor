import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';

interface VRMAvatarProps {
  url: string;
  animation: string;
  speaking: boolean;
}

function VRMAvatarInner({ url, animation, speaking }: VRMAvatarProps) {
  const { scene } = useThree();
  const vrmRef = useRef<VRM | null>(null);
  const modelRef = useRef<THREE.Group>(null);
  const clockRef = useRef(new THREE.Clock());
  const [loadError, setLoadError] = useState(false);
  const speakingPhase = useRef(0);

  const cleanup = useCallback(() => {
    if (vrmRef.current) {
      scene.remove(vrmRef.current.scene);
      vrmRef.current = null;
    }
  }, [scene]);

  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          console.warn(`[VRMAvatar] No VRM data found in model: ${url}`);
          setLoadError(true);
          return;
        }

        // Rotate model to face forward (VRM models face +Z by default)
        vrm.scene.rotation.y = Math.PI;

        vrmRef.current = vrm;
        if (modelRef.current) {
          modelRef.current.add(vrm.scene);
        }
        clockRef.current.start();
      },
      undefined,
      (error) => {
        console.warn(`[VRMAvatar] Failed to load VRM model: ${url}`, error);
        setLoadError(true);
      },
    );

    return cleanup;
  }, [url, cleanup]);

  useFrame((_, delta) => {
    const vrm = vrmRef.current;
    if (!vrm) return;

    // Update VRM internal state
    vrm.update(delta);

    const time = clockRef.current.getElapsedTime();

    // Idle breathing/swaying animation
    if (vrm.humanoid) {
      const spine = vrm.humanoid.getNormalizedBoneNode('spine');
      if (spine) {
        // Gentle breathing motion
        spine.rotation.x = Math.sin(time * 1.2) * 0.015;
        // Subtle lateral sway
        spine.rotation.z = Math.sin(time * 0.8) * 0.01;
      }

      const head = vrm.humanoid.getNormalizedBoneNode('head');
      if (head) {
        // Slight head movement based on animation state
        if (animation === 'listening') {
          head.rotation.x = -0.05 + Math.sin(time * 0.5) * 0.01;
        } else if (animation === 'wave') {
          head.rotation.z = Math.sin(time * 3) * 0.04;
        } else {
          head.rotation.x = Math.sin(time * 0.6) * 0.02;
          head.rotation.z = Math.sin(time * 0.4) * 0.01;
        }
      }
    }

    // Speaking mouth animation via expression manager
    if (vrm.expressionManager) {
      if (speaking) {
        speakingPhase.current += delta * 12;
        // Oscillate mouth open/close with some variation
        const mouthValue =
          0.3 +
          Math.sin(speakingPhase.current) * 0.25 +
          Math.sin(speakingPhase.current * 1.7) * 0.15;
        vrm.expressionManager.setValue(
          VRMExpressionPresetName.Aa,
          Math.max(0, Math.min(1, mouthValue)),
        );
        // Slight expression changes while speaking
        vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.1);
      } else {
        // Smoothly close mouth when not speaking
        const currentAa = vrm.expressionManager.getValue(VRMExpressionPresetName.Aa) ?? 0;
        if (currentAa > 0.01) {
          vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, currentAa * 0.85);
        } else {
          vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, 0);
        }
        vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0);
        speakingPhase.current = 0;
      }

      // Natural blinking
      const blinkCycle = time % 4;
      if (blinkCycle > 3.7 && blinkCycle < 3.9) {
        const blinkProgress = (blinkCycle - 3.7) / 0.2;
        const blinkValue = blinkProgress < 0.5 ? blinkProgress * 2 : (1 - blinkProgress) * 2;
        vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, blinkValue);
      } else {
        vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, 0);
      }
    }
  });

  if (loadError) {
    return null;
  }

  return <group ref={modelRef} />;
}

export const VRMAvatar = React.memo(VRMAvatarInner);
