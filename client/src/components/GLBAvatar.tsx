import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface GLBAvatarProps {
  url: string;
  animation: string;
  speaking: boolean;
}

function GLBAvatarInner({ url, animation, speaking }: GLBAvatarProps) {
  const { scene } = useThree();
  const modelRef = useRef<THREE.Group>(null);
  const loadedSceneRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const [loadError, setLoadError] = useState(false);
  const speakingPhase = useRef(0);

  const cleanup = useCallback(() => {
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }
    if (loadedSceneRef.current) {
      loadedSceneRef.current.removeFromParent();
      loadedSceneRef.current.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else if (mat) {
            (mat as THREE.Material).dispose();
          }
        }
      });
      loadedSceneRef.current = null;
    }
  }, []);

  useEffect(() => {
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        const gltfScene = gltf.scene;

        // Some Sketchfab GLBs pack multiple pose skeletons into one model
        // (Nygma ships 4: Tpose / Idle / Walk / Death). Every skinned mesh
        // renders at the same origin in its bind pose, so the silhouette is
        // a tangled overlay — and bind poses like "Death" (lying flat) wreck
        // the bbox-based scale/ground calculation below. Pick one skin and
        // hide the rest BEFORE we measure.
        const skinnedMeshes: THREE.SkinnedMesh[] = [];
        gltfScene.traverse((obj) => {
          const sm = obj as THREE.SkinnedMesh;
          if (sm.isSkinnedMesh) skinnedMeshes.push(sm);
        });
        const rankSkin = (sm: THREE.SkinnedMesh): number => {
          const boneNames = (sm.skeleton?.bones || []).map((b) => b.name).join(' ');
          const tag = `${sm.name} ${boneNames}`.toLowerCase();
          if (/idle|stand|breath/.test(tag)) return 0;
          if (/tpose|a[-_ ]?pose/.test(tag)) return 1;
          if (/walk/.test(tag)) return 2;
          if (/death|die|down|fall|floor/.test(tag)) return 9;
          return 3;
        };
        skinnedMeshes.sort((a, b) => rankSkin(a) - rankSkin(b));
        const chosenSkin = skinnedMeshes[0] ?? null;
        for (const sm of skinnedMeshes) {
          if (sm !== chosenSkin) sm.visible = false;
        }

        // Auto-scale to ~1.6 units tall (matches VRM default visual size).
        // Box3.setFromObject respects .visible on descendants, so the hidden
        // alternate-pose skins don't pollute the measurement. Guard against
        // non-finite bbox values (Sketchfab multi-skin packs sometimes ship
        // uninitialized / Infinity bind-pose verts → NaN bbox → NaN scale).
        const bbox = new THREE.Box3().setFromObject(gltfScene);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const bboxValid =
          Number.isFinite(size.x) &&
          Number.isFinite(size.y) &&
          Number.isFinite(size.z) &&
          size.y > 0.001;
        const scale = bboxValid ? 1.6 / size.y : 1;
        gltfScene.scale.setScalar(scale);

        // Re-measure after scaling, then center on X/Z and ground Y=0.
        gltfScene.updateMatrixWorld(true);
        bbox.setFromObject(gltfScene);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        if (Number.isFinite(center.x)) gltfScene.position.x -= center.x;
        if (Number.isFinite(center.z)) gltfScene.position.z -= center.z;
        if (Number.isFinite(bbox.min.y)) gltfScene.position.y -= bbox.min.y;

        // Enable shadow casting
        gltfScene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });

        // Play shipped idle animation if present — without this, skinned
        // meshes stay in bind-pose (T-pose for humans) or exhibit undriven
        // skin deformation ("rippling"). Prefer idle/stand-named clips.
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(gltfScene);
          const clip =
            gltf.animations.find((c) => /idle|stand|breath/i.test(c.name)) || gltf.animations[0];
          if (clip) {
            // Filter clip tracks to only those driving the chosen skin's
            // bones. A track name is `<nodeName>.<property>` — property is
            // never a substring with a dot, so split on the LAST '.' to
            // preserve node names that contain dots.
            const chosenBones = new Set<string>();
            if (chosenSkin?.skeleton) {
              for (const bone of chosenSkin.skeleton.bones) chosenBones.add(bone.name);
            }
            let activeClip = clip;
            if (chosenBones.size > 0) {
              const filtered = clip.tracks.filter((t) => {
                const dot = t.name.lastIndexOf('.');
                const nodeName = dot >= 0 ? t.name.slice(0, dot) : t.name;
                return chosenBones.has(nodeName);
              });
              if (filtered.length > 0 && filtered.length < clip.tracks.length) {
                activeClip = new THREE.AnimationClip(clip.name, clip.duration, filtered);
              }
            }
            const action = mixer.clipAction(activeClip);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
          }
          mixerRef.current = mixer;
        } else {
          // Fallback for models with no animation clips — rotate upper-arm
          // bones downward so humans read as standing, not Vitruvian-man.
          // Rig-agnostic heuristic: match common upper-arm names, skip
          // forearms/hands. Best-effort; may need per-model tweaks.
          const isUpperArm = (name: string): 'L' | 'R' | null => {
            const n = name.toLowerCase();
            if (/forearm|lower|hand|finger|thumb|elbow/.test(n)) return null;
            const isArm = /arm|shoulder|humerus/.test(n);
            if (!isArm) return null;
            if (/(^|[^a-z])(l|left)([^a-z]|$)|_l$|\.l$/.test(n)) return 'L';
            if (/(^|[^a-z])(r|right)([^a-z]|$)|_r$|\.r$/.test(n)) return 'R';
            return null;
          };
          gltfScene.traverse((obj) => {
            const side = isUpperArm(obj.name);
            if (!side) return;
            // +Z on most rigs swings left arm down; mirror for right.
            obj.rotation.z = side === 'L' ? 1.2 : -1.2;
          });
        }

        loadedSceneRef.current = gltfScene;
        if (modelRef.current) {
          modelRef.current.add(gltfScene);
        }
        clockRef.current.start();
      },
      undefined,
      (error) => {
        console.warn(`[GLBAvatar] Failed to load GLB model: ${url}`, error);
        setLoadError(true);
      },
    );

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useFrame((_, delta) => {
    const model = loadedSceneRef.current;
    if (!model) return;

    if (mixerRef.current) mixerRef.current.update(delta);

    const time = clockRef.current.getElapsedTime();

    // Per-animation root motion (no humanoid bones; rotate/position the root group)
    if (modelRef.current) {
      if (animation === 'walking') {
        // Stride bob: faster vertical, no idle Y-sway, subtle lateral shift
        modelRef.current.rotation.y = 0;
        modelRef.current.position.y = Math.abs(Math.sin(time * 6)) * 0.05;
      } else {
        // Gentle idle sway
        modelRef.current.rotation.y = Math.sin(time * 0.4) * 0.05;
        modelRef.current.position.y = Math.sin(time * 1.2) * 0.02;
      }
    }

    // Speaking "bounce" — subtle bob faster when speaking (skipped while walking)
    if (speaking && animation !== 'walking' && modelRef.current) {
      speakingPhase.current += delta * 8;
      modelRef.current.position.y += Math.sin(speakingPhase.current) * 0.015;
    } else if (!speaking) {
      speakingPhase.current = 0;
    }

    // Head-tilt lerp: listening tilts right, walking leans forward-ish
    const targetZ = animation === 'listening' ? 0.03 : 0;
    if (modelRef.current) {
      modelRef.current.rotation.z = THREE.MathUtils.lerp(
        modelRef.current.rotation.z,
        targetZ,
        delta * 2,
      );
    }
  });

  if (loadError) {
    return null;
  }

  return <group ref={modelRef} />;
}

export const GLBAvatar = React.memo(GLBAvatarInner);
