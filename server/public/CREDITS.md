# Asset Credits

## 3D Models (Sketchfab)

- **arcade.glb** — "Arcade Machine" — CC-BY-SA 4.0
  - Sketchfab UID: `e2177689272b48089a22a455b820944a`
- **pool-table.glb** — "Pool Table" — CC-BY 4.0
  - Sketchfab UID: `4dcb0e9d6802443fb4f8ea8ff79c2dc4`
- **server-rack.glb** — "Server Rack" — CC-BY 4.0
  - Sketchfab UID: `62f6779cb7e448b19aaf58544c3c7218`
- **sofa.glb** — "Sofa (Game Ready, 2K PBR)" — CC-BY 4.0
  - Sketchfab UID: `959bc21f62964c068e441622e8d1103a`

## Textures (Poly Haven)

- **textures/floor/\*.jpg** — "Wood Floor Deck" — CC0
  - 2k JPG variants (diffuse, GL-convention normal, roughness)
  - Poly Haven — CC0, no attribution required (credited anyway)

## Avatar Animations (Mixamo + VRM Retarget)

- **animations/margot-*.vrma** — Mixamo source motions, retargeted to VRM humanoid and exported as VRMA
  - Source: Adobe Mixamo (https://www.mixamo.com/)
  - Retrieved from public Mixamo FBX mirror: `S-N-D-R/UnityMixamoLibrary` (GitHub)
  - License: Mixamo free use for commercial and non-commercial projects (account required)
  - Conversion pipeline: Mixamo FBX -> FBX2glTF -> VRMA (`tk256ailab/fbx2vrma-converter`, adjusted for non-prefixed Mixamo bone names)
  - Specific source clips:
    - `idle_7.fbx` -> `margot-idle.vrma`
    - `walk_13.fbx` -> `margot-walk.vrma`
    - `talking_3.fbx` -> `margot-talk.vrma`
    - `wave_1.fbx` -> `margot-wave.vrma`
    - `typing.fbx` -> `margot-typing.vrma`
    - `sitting_idle.fbx` -> `margot-sit-idle.vrma`
    - `nod_1.fbx` -> `margot-nod.vrma`
    - `thumbs_up_big.fbx` -> `margot-thumbs-up.vrma`
  - Expected clip names:
    - `margot-idle.vrma`
    - `margot-walk.vrma`
    - `margot-talk.vrma`
    - `margot-wave.vrma`
    - `margot-typing.vrma`
    - `margot-sit-idle.vrma`
    - `margot-thumbs-up.vrma`
    - `margot-nod.vrma`

All assets redistributable under their respective licenses.
