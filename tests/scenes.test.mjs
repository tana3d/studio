import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { editableScene } from '../editor/scenes.js';
test('scene pieces preserve metre scale and nested transforms and can move independently',()=>{
 const root=new THREE.Group(),room=new THREE.Group();room.position.set(7,0,-5);room.rotation.y=Math.PI/2;root.add(room);
 const wall=new THREE.Mesh(new THREE.BoxGeometry(8,3,.2),new THREE.MeshStandardMaterial());wall.name='Wall';wall.position.set(0,1.5,0);room.add(wall);
 const floor=new THREE.Mesh(new THREE.BoxGeometry(8,.1,6),wall.material);floor.position.set(0,-.05,0);floor.name='Floor';room.add(floor);
 const {pieces,bounds}=editableScene({scene:root},'room');assert.equal(pieces.length,2);
 assert.ok(pieces[0].size.z>7.9);assert.ok(Math.abs(pieces[0].size.y-3)<.001);assert.equal(pieces[1].walkable,true);
 const reconstructed=new THREE.Group();for(const piece of pieces){const pivot=new THREE.Group();pivot.position.fromArray(piece.position);pivot.add(piece.model);reconstructed.add(pivot);}
 const box=new THREE.Box3().setFromObject(reconstructed);assert.ok(Math.abs(box.min.y)<.001);assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x)<.001);
 assert.notEqual(pieces[0].model.material,pieces[1].model.material);assert.ok(bounds[1][0]>=10);
 pieces[0].model.position.x+=2;assert.notEqual(pieces[0].model.position.x,pieces[1].model.position.x);
});
