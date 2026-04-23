import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

interface VRMAvatarProps {
  url: string;
  animation: string;
  speaking: boolean;
}

type ClipKey = 'idle' | 'walk' | 'talk' | 'wave' | 'typing' | 'sitIdle' | 'nod' | 'thumbsUp';

const FADE_SECONDS = 0.25;
const ONE_SHOT_CLIPS = new Set<ClipKey>(['wave', 'nod', 'thumbsUp']);

const ANIMATION_ALIASES: Record<string, ClipKey[]> = {
  idle: ['idle'],
  walking: ['walk'],
  talking: ['talk', 'wave', 'idle'],
  wave: ['wave', 'talk', 'idle'],
  typing: ['typing', 'sitIdle', 'idle'],
  listening: ['idle'],
  presenting: ['talk', 'wave', 'idle'],
  nod: ['nod', 'talk', 'idle'],
  'sit-idle': ['sitIdle', 'idle'],
  sit_idle: ['sitIdle', 'idle'],
  sitidle: ['sitIdle', 'idle'],
  'thumbs-up': ['thumbsUp', 'wave', 'idle'],
  thumbsup: ['thumbsUp', 'wave', 'idle'],
};

const CLIP_BASENAME: Record<ClipKey, string> = {
  idle: 'idle',
  walk: 'walk',
  talk: 'talk',
  wave: 'wave',
  typing: 'typing',
  sitIdle: 'sit-idle',
  nod: 'nod',
  thumbsUp: 'thumbs-up',
};

function normalizeAnimationName(animation: string): string {
  return animation.trim().toLowerCase().replace(/\s+/g, '-');
}

function getAvatarSlug(url: string): string {
  const withoutQuery = url.split('?')[0];
  const filename = withoutQuery.split('/').pop() ?? 'avatar';
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename).toLowerCase();
}

function buildClipUrls(avatarUrl: string): Record<ClipKey, string[]> {
  const slug = getAvatarSlug(avatarUrl);
  const entries = Object.entries(CLIP_BASENAME) as Array<[ClipKey, string]>;
  const output = {} as Record<ClipKey, string[]>;
  for (const [clipKey, baseName] of entries) {
    output[clipKey] = [`/animations/${slug}-${baseName}.vrma`, `/animations/${baseName}.vrma`];
  }
  return output;
}

function resolveClip(
  animation: string,
  actions: Map<ClipKey, THREE.AnimationAction>,
): ClipKey | null {
  const normalized = normalizeAnimationName(animation);
  const candidates = ANIMATION_ALIASES[normalized] ?? [normalized as ClipKey, 'idle'];
  for (const candidate of candidates) {
    if (actions.has(candidate)) return candidate;
  }
  return actions.has('idle') ? 'idle' : null;
}

function VRMAvatarInner({ url, animation, speaking }: VRMAvatarProps) {
  const { scene } = useThree();
  const vrmRef = useRef<VRM | null>(null);
  const modelRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<ClipKey, THREE.AnimationAction>>(new Map());
  const currentClipRef = useRef<ClipKey | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const [loadError, setLoadError] = useState(false);
  const speakingPhase = useRef(0);

  const cleanup = useCallback(() => {
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }
    actionsRef.current.clear();
    currentClipRef.current = null;
    if (vrmRef.current) {
      vrmRef.current.scene.removeFromParent();
      vrmRef.current = null;
    }
  }, []);

  const playClip = useCallback((clip: ClipKey | null, fadeSeconds = FADE_SECONDS) => {
    if (!clip) return;
    const actions = actionsRef.current;
    const nextAction = actions.get(clip);
    if (!nextAction) return;

    const previousClip = currentClipRef.current;
    if (previousClip === clip) return;

    const previousAction = previousClip ? actions.get(previousClip) : null;

    nextAction.enabled = true;
    nextAction.setEffectiveWeight(1);
    nextAction.setEffectiveTimeScale(1);
    nextAction.clampWhenFinished = ONE_SHOT_CLIPS.has(clip);
    nextAction.setLoop(ONE_SHOT_CLIPS.has(clip) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    nextAction.reset();
    nextAction.play();

    if (previousAction) {
      nextAction.crossFadeFrom(previousAction, fadeSeconds, true);
    } else {
      nextAction.fadeIn(fadeSeconds);
    }

    currentClipRef.current = clip;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    cleanup();

    const modelLoader = new GLTFLoader();
    modelLoader.register((parser) => new VRMLoaderPlugin(parser));

    const animationLoader = new GLTFLoader();
    animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const loadClip = async (vrm: VRM, clipKey: ClipKey, candidates: string[]) => {
      for (const candidateUrl of candidates) {
        try {
          const gltf = await animationLoader.loadAsync(candidateUrl);
          const vrmAnimations = (gltf.userData?.vrmAnimations as unknown[]) ?? [];
          const first = vrmAnimations[0];
          if (!first) continue;
          const clip = createVRMAnimationClip(first, vrm);
          clip.name = clipKey;
          return clip;
        } catch {
          // Try next candidate path.
        }
      }
      return null;
    };

    (async () => {
      try {
        const gltf = await modelLoader.loadAsync(url);
        if (cancelled) return;

        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          console.warn(`[VRMAvatar] No VRM data found in model: ${url}`);
          setLoadError(true);
          return;
        }

        vrm.scene.rotation.y = Math.PI;
        vrmRef.current = vrm;
        if (modelRef.current) {
          modelRef.current.add(vrm.scene);
        } else {
          scene.add(vrm.scene);
        }

        const mixer = new THREE.AnimationMixer(vrm.scene);
        mixerRef.current = mixer;
        const actions = new Map<ClipKey, THREE.AnimationAction>();
        const clipUrls = buildClipUrls(url);
        const clipKeys = Object.keys(clipUrls) as ClipKey[];

        await Promise.all(
          clipKeys.map(async (clipKey) => {
            const clip = await loadClip(vrm, clipKey, clipUrls[clipKey]);
            if (!clip || cancelled) return;
            const action = mixer.clipAction(clip);
            actions.set(clipKey, action);
          }),
        );

        if (cancelled) return;

        actionsRef.current = actions;
        if (actions.size === 0) {
          console.warn(`[VRMAvatar] No VRMA clips found for avatar ${url}`);
        }

        const initialClip = resolveClip(animation, actions);
        playClip(initialClip);
        clockRef.current.start();
      } catch (error) {
        if (!cancelled) {
          console.warn(`[VRMAvatar] Failed to load VRM model: ${url}`, error);
          setLoadError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [url, scene, cleanup, playClip]);

  useEffect(() => {
    const clip = resolveClip(animation, actionsRef.current);
    playClip(clip);
  }, [animation, playClip]);

  useFrame((_, delta) => {
    const vrm = vrmRef.current;
    if (!vrm) return;

    if (mixerRef.current) {
      mixerRef.current.update(delta);
      const current = currentClipRef.current;
      if (current && ONE_SHOT_CLIPS.has(current)) {
        const currentAction = actionsRef.current.get(current);
        if (currentAction && !currentAction.isRunning()) {
          playClip(resolveClip('idle', actionsRef.current), 0.2);
        }
      }
    }

    vrm.update(delta);
    const time = clockRef.current.getElapsedTime();

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
