# VRMA Clips

This directory holds retargeted VRM Animation (`.vrma`) clips served at `/animations/*`.

For Margot's VRM avatar (`/avatars/margot.vrm`), the client loads these filenames first:

- `margot-idle.vrma`
- `margot-walk.vrma`
- `margot-talk.vrma`
- `margot-wave.vrma`
- `margot-typing.vrma`
- `margot-sit-idle.vrma`
- `margot-thumbs-up.vrma`
- `margot-nod.vrma`

Fallback lookup without prefix is also supported (for example `idle.vrma`, `walk.vrma`).

Pipeline:

1. Download animation clips from Mixamo as FBX.
2. Retarget to the VRM humanoid in Blender using VRM Add-on 2.x.
3. Export each clip as VRMA.
4. Place the resulting files in this directory.
