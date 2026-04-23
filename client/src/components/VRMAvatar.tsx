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

        // One-shot diagnostic: which humanoid bones actually resolve?
        // If any of these report false, we can't animate that limb and
        // the model will stay in bind pose for that joint.
        const h = vrm.humanoid;
        console.log('[VRMAvatar] loaded', {
          url,
          hasHumanoid: !!h,
          spine: !!h?.getNormalizedBoneNode('spine'),
          leftUpperArm: !!h?.getNormalizedBoneNode('leftUpperArm'),
          rightUpperArm: !!h?.getNormalizedBoneNode('rightUpperArm'),
          leftUpperLeg: !!h?.getNormalizedBoneNode('leftUpperLeg'),
          rightUpperLeg: !!h?.getNormalizedBoneNode('rightUpperLeg'),
          leftLowerArm: !!h?.getNormalizedBoneNode('leftLowerArm'),
          rightLowerArm: !!h?.getNormalizedBoneNode('rightLowerArm'),
        });

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

    // Humanoid-driven idle / walk / listen / wave pose
    if (vrm.humanoid) {
      const spine = vrm.humanoid.getNormalizedBoneNode('spine');
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
      const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
      const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
      const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
      const leftUpperLeg = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
      const rightUpperLeg = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg');

      // Baseline rest pose — VRMs ship in T-pose (arms straight out). Push
      // upper arms down to the sides so the default looks human, not scarecrow.
      // NOTE: normalized VRM humanoid bones are NOT mirrored — both sides
      // use the same-sign rotation to achieve the same visual pose.
      const REST_ARM_Z = 1.25; // ~72° — natural shoulder abduction
      if (leftUpperArm) {
        leftUpperArm.rotation.z = REST_ARM_Z;
        leftUpperArm.rotation.y = 0;
      }
      if (rightUpperArm) {
        rightUpperArm.rotation.z = REST_ARM_Z;
        rightUpperArm.rotation.y = 0;
      }
      // Elbows relaxed — rotation.y on the normalized lower arm is a
      // forearm TWIST, not an elbow bend. Leaving that at 0 stops the
      // rubber-hose look. Reset all axes so wave/listen residuals don't
      // leak into idle.
      if (leftLowerArm) {
        leftLowerArm.rotation.x = 0;
        leftLowerArm.rotation.y = 0;
        leftLowerArm.rotation.z = 0;
      }
      if (rightLowerArm) {
        rightLowerArm.rotation.x = 0;
        rightLowerArm.rotation.y = 0;
        rightLowerArm.rotation.z = 0;
      }

      if (animation === 'walking') {
        // Forward lean + faster breathing
        if (spine) {
          spine.rotation.x = 0.06 + Math.sin(time * 6) * 0.015;
          spine.rotation.z = Math.sin(time * 3) * 0.02;
        }
        // Arm swing — upper arms rotate on X in opposite phase, layered
        // on top of the rest-pose z-roll we set above. ~1.5Hz cadence to
        // match the 1.8 u/s walk speed set client-side.
        const armSwing = Math.sin(time * 10) * 0.6;
        if (leftUpperArm) leftUpperArm.rotation.x = armSwing;
        if (rightUpperArm) rightUpperArm.rotation.x = -armSwing;
        // Leg stride — opposite phase to same-side arm (natural cross-gait)
        const legSwing = Math.sin(time * 10) * 0.5;
        if (leftUpperLeg) leftUpperLeg.rotation.x = -legSwing;
        if (rightUpperLeg) rightUpperLeg.rotation.x = legSwing;
        if (head) {
          head.rotation.x = Math.sin(time * 10) * 0.02;
          head.rotation.z = 0;
        }
      } else {
        if (spine) {
          spine.rotation.x = Math.sin(time * 1.2) * 0.015;
          spine.rotation.z = Math.sin(time * 0.8) * 0.01;
        }
        // Gentle idle arm sway — same sign both sides (non-mirrored bones).
        // Opposite signs made the right arm visibly flail while the left
        // looked still.
        const idleSway = Math.sin(time * 1.0) * 0.03;
        if (leftUpperArm) leftUpperArm.rotation.x = idleSway;
        if (rightUpperArm) rightUpperArm.rotation.x = idleSway;
        // Legs back to neutral when not walking
        if (leftUpperLeg) leftUpperLeg.rotation.x *= 0.9;
        if (rightUpperLeg) rightUpperLeg.rotation.x *= 0.9;
        if (head) {
          if (animation === 'listening') {
            head.rotation.x = -0.05 + Math.sin(time * 0.5) * 0.01;
          } else if (animation === 'wave') {
            // Classic wave: upper arm overhead, elbow bent ~90° forward,
            // forearm waggles on y-axis only. Previous version oscillated
            // lower-arm z which combined with the y-bend to twist the mesh.
            if (rightUpperArm) {
              rightUpperArm.rotation.z = -1.4;
              rightUpperArm.rotation.x = 0;
              rightUpperArm.rotation.y = 0;
            }
            if (rightLowerArm) {
              rightLowerArm.rotation.x = 1.4;
              rightLowerArm.rotation.y = Math.sin(time * 8) * 0.5;
              rightLowerArm.rotation.z = 0;
            }
            head.rotation.z = Math.sin(time * 3) * 0.04;
          } else {
            head.rotation.x = Math.sin(time * 0.6) * 0.02;
            head.rotation.z = Math.sin(time * 0.4) * 0.01;
          }
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
