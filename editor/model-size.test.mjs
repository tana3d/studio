import test from 'node:test';
import assert from 'node:assert/strict';
import { Group,Mesh,BoxGeometry,MeshBasicMaterial,Box3,Vector3 } from 'three';
import { scaleModel } from './model-size.js';
test('resizing instances preserves ground contact, dimensions, and shared model geometry',()=>{
 const mesh=new Mesh(new BoxGeometry(2,3,4),new MeshBasicMaterial());
 const group=new Group();group.add(mesh);group.position.set(2,1.5,3);
 const other=group.clone(true),bounds=()=>new Box3().setFromObject(group);
 scaleModel(group,3);assert.equal(bounds().min.y,0);assert.deepEqual(bounds().getSize(new Vector3()).toArray(),[6,9,12]);
 assert.deepEqual(new Box3().setFromObject(other).getSize(new Vector3()).toArray(),[2,3,4]);assert.equal(other.children[0].geometry,mesh.geometry);
 scaleModel(group,1);assert.equal(group.position.y,1.5);assert.deepEqual(bounds().getSize(new Vector3()).toArray(),[2,3,4]);
 scaleModel(group,25);assert.equal(group.scale.x,25);
 for(const value of [0,-1,NaN,Infinity])assert.throws(()=>scaleModel(group,value));
});
test('character resizing keeps its placement pivot fixed',()=>{
 const group=new Group();group.position.set(1,0,2);group.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()));scaleModel(group,.5,false);assert.deepEqual(group.position.toArray(),[1,0,2]);
});
