// Patch THREE.BufferGeometry.computeBoundingSphere to:
//   1) log the offending mesh ONCE per unique name+uuid so the console
//      isn't drowned in per-frame NaN warnings during render-loop frustum
//      culling, and
//   2) set a finite zero-radius bounding sphere on the geometry so THREE
//      stops recomputing it every frame (and culls the mesh out cleanly).
//
// Root cause of NaN is usually a skinned mesh whose bind pose has
// uninitialized / Infinity vertices (common in Sketchfab multi-skeleton
// exports). This patch doesn't fix the model — it contains the blast
// radius so one bad mesh can't spam the console + drop framerate.
import * as THREE from 'three';

const loggedUuids = new Set<string>();

const original = THREE.BufferGeometry.prototype.computeBoundingSphere;

THREE.BufferGeometry.prototype.computeBoundingSphere = function computeBoundingSphereGuarded() {
  original.call(this);

  const s = this.boundingSphere;
  if (!s) return;
  const invalid =
    !Number.isFinite(s.radius) ||
    !Number.isFinite(s.center.x) ||
    !Number.isFinite(s.center.y) ||
    !Number.isFinite(s.center.z);
  if (!invalid) return;

  // Find owning mesh via userData reverse-lookup (best effort)
  let ownerName = '(unknown)';
  const owner = (this as unknown as { __owner__?: THREE.Object3D }).__owner__;
  if (owner) {
    ownerName = `${owner.type}:${owner.name || '(unnamed)'}`;
  }

  if (!loggedUuids.has(this.uuid)) {
    loggedUuids.add(this.uuid);
    console.warn(
      `[harbor:nan-guard] BufferGeometry ${this.uuid} has NaN bounds — owner=${ownerName}, attrs=${Object.keys(this.attributes).join(',')}. Clamping to zero-radius sphere.`,
    );
  }

  // Replace with a finite dummy so subsequent culling & render don't retrigger.
  this.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0);
};

// Tag geometries with their owner when a mesh is constructed, so our
// warning can name names. Monkeypatching Mesh constructor is fragile;
// we hook setupMaterial via Object3D.add instead, which every mesh goes
// through when parented into the scene.
const originalAdd = THREE.Object3D.prototype.add;
THREE.Object3D.prototype.add = function addWithOwnerTag(...objects: THREE.Object3D[]) {
  const tag = (obj: THREE.Object3D) => {
    // Tag geometry on anything that has one — Mesh, Points, Line, InstancedMesh,
    // SkinnedMesh. R3F often adds subtrees rather than leaf nodes, so traverse.
    const withGeom = obj as unknown as { geometry?: THREE.BufferGeometry };
    if (withGeom.geometry) {
      (withGeom.geometry as unknown as { __owner__?: THREE.Object3D }).__owner__ = obj;
    }
  };
  for (const obj of objects) {
    tag(obj);
    obj.traverse?.(tag);
  }
  return originalAdd.apply(this, objects as [THREE.Object3D]);
};
