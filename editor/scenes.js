import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// Keep glTF's metre scale and each named set piece together (a tree's trunk
// and canopy, for example), preserving all nested world transforms.
export function editableScene(gltf, id) {
  const source=clone(gltf.scene);source.updateMatrixWorld(true);
  source.traverse(node=>{if(node.isSkinnedMesh)throw new Error('Import animated actors separately in Characters.');});
  const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3());
  if(bounds.isEmpty()||![size.x,size.y,size.z].every(Number.isFinite)||Math.max(size.x,size.y,size.z)>1000)throw new Error('This scene has invalid dimensions.');
  const center=bounds.getCenter(new THREE.Vector3()),offset=new THREE.Vector3(-center.x,-bounds.min.y,-center.z);
  let container=source;
  while(container.children.length===1&&!container.children[0].isMesh)container=container.children[0];
  const pieces=[];
  for(const node of container.children.length?container.children:[container]){
    let visible=true;for(let parent=node;parent;parent=parent.parent)if(!parent.visible)visible=false;
    if(!visible)continue;
    const copy=node.clone(true);copy.matrix.copy(node.matrixWorld);copy.matrix.decompose(copy.position,copy.quaternion,copy.scale);copy.matrixAutoUpdate=true;copy.position.add(offset);
    const box=new THREE.Box3().setFromObject(copy);if(box.isEmpty())continue;
    const s=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3()),position=[c.x,box.min.y,c.z];
    copy.position.sub(new THREE.Vector3(...position));
    copy.traverse(mesh=>{if(!mesh.isMesh)return;mesh.material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();mesh.castShadow=true;mesh.receiveShadow=true;});
    pieces.push({id:`${id}-piece-${pieces.length}`,name:node.name?.replace(/_/g,' ')||`Set piece ${pieces.length+1}`,model:copy,position,size:s,walkable:s.y<.25&&Math.max(s.x,s.z)>2});
  }
  if(!pieces.length)throw new Error('This scene contains no editable meshes.');
  return {pieces,bounds:[[-Math.max(10,size.x/2+3),-Math.max(10,size.z/2+3)],[Math.max(10,size.x/2+3),Math.max(10,size.z/2+3)]]};
}
