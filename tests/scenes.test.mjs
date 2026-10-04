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
test('a named multi-mesh tree remains one editable piece',()=>{
 const scene=new THREE.Group(),set=new THREE.Group(),tree=new THREE.Group();tree.name='Pine_tree_1';scene.add(set);set.add(tree);
 const trunk=new THREE.Mesh(new THREE.BoxGeometry(.3,2,.3),new THREE.MeshStandardMaterial());trunk.position.y=1;tree.add(trunk);
 const crown=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),trunk.material);crown.position.y=2.8;tree.add(crown);
 const floor=new THREE.Mesh(new THREE.BoxGeometry(10,.1,10),trunk.material);floor.position.y=-.05;set.add(floor);
 const result=editableScene({scene},'forest');assert.equal(result.pieces.length,2);assert.equal(result.pieces[0].name,'Pine tree 1');assert.equal(result.pieces[0].model.children.length,2);assert.ok(result.pieces[0].size.y>3.7);
});
