import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// A scene keeps glTF's metre scale and becomes editable pieces rather than a
// miniature prop. Original geometry/materials and world transforms are preserved.
export function editableScene(gltf, id) {
  const source=clone(gltf.scene);source.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3());
  if(bounds.isEmpty()||![size.x,size.y,size.z].every(Number.isFinite)||Math.max(size.x,size.y,size.z)>1000)throw new Error('This scene has invalid dimensions.');
  const center=bounds.getCenter(new THREE.Vector3()),offset=new THREE.Vector3(-center.x,-bounds.min.y,-center.z);
  const pieces=[];
  source.traverse(mesh=>{
    if(!mesh.isMesh)return;
    for(let parent=mesh;parent;parent=parent.parent)if(!parent.visible)return;
    if(mesh.isSkinnedMesh)throw new Error('Import animated actors separately in Characters.');
    const copy=mesh.clone(false);copy.matrix.copy(mesh.matrixWorld);copy.matrix.decompose(copy.position,copy.quaternion,copy.scale);copy.matrixAutoUpdate=true;copy.position.add(offset);
    const box=new THREE.Box3().setFromObject(copy),s=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
    const position=[c.x,box.min.y,c.z];copy.position.sub(new THREE.Vector3(...position));
    copy.material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();
    copy.castShadow=true;copy.receiveShadow=true;
    pieces.push({id:`${id}-piece-${pieces.length}`,name:mesh.name||`Set piece ${pieces.length+1}`,model:copy,position,size:s,walkable:s.y<.25&&Math.max(s.x,s.z)>2});
  });
  if(!pieces.length)throw new Error('This scene contains no editable meshes.');
  return {pieces,bounds:[[-Math.max(10,size.x/2+3),-Math.max(10,size.z/2+3)],[Math.max(10,size.x/2+3),Math.max(10,size.z/2+3)]]};
}
