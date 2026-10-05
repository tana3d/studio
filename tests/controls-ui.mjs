import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, webkit, expect } from 'playwright/test';

const root=resolve('out');
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')&&path!==root){res.writeHead(403).end();return;}
  try{const file=path.endsWith('/')||!extname(path)?path+'/index.html':path;const body=await readFile(file);
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary'}[extname(file)]??'application/octet-stream'}).end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await (process.env.TEST_BROWSER==='webkit'?webkit:chromium).launch({headless:process.env.HEADED!=='1'});
try{
  const page=await browser.newPage({viewport:{width:1500,height:960},deviceScaleFactor:.5});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.text().includes('Mouse capture unavailable'))console.log(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const editor=page.frames().find(frame=>frame.url().includes('/studio/index.html'));
  await editor.waitForFunction(()=>window.__studio?.ready);
  // Shortcuts also work when focus starts in the chat pane.
  await page.getByRole('button',{name:'Collapse chat'}).focus();
  await page.keyboard.press('Meta+Shift+Digit2');
  await editor.waitForFunction(()=>window.__studio.camIndex===0&&window.__studio.controlMode==='camera');
  await page.keyboard.press('Meta+Shift+Digit1');
  await editor.waitForFunction(()=>window.__studio.camIndex===-1);
  await page.keyboard.press('Meta+Shift+Backquote');
  await editor.waitForFunction(()=>window.__studio.controlMode==='character');
  assert.equal(await editor.locator('#cam-free .shortcut-badge').textContent(),'1');
  assert.equal(await editor.locator('#cam-0 .shortcut-badge').textContent(),'2');
  const actor=()=>editor.evaluate(()=>{const a=window.__studio.actors.Vale;return {pos:a.group.position.toArray(),velocity:a.velocity.toArray(),idle:a.layers[a.idle].weight};});
  await editor.evaluate(()=>{const a=window.__studio.actors.Vale;a.group.position.set(0,0,-16);a.velocity.set(0,0);window.__player.yaw=0;});
  const start=await actor();
  await page.keyboard.down('KeyW');await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  const diagonal=await actor();
  assert.ok(diagonal.pos[0]>start.pos[0]+.3&&diagonal.pos[2]<start.pos[2]-.3);
  assert.ok(Math.abs((diagonal.pos[0]-start.pos[0])+(diagonal.pos[2]-start.pos[2]))<.08,'W+D maintains a precise diagonal');
  await page.keyboard.up('KeyW');await page.keyboard.up('KeyD');
  await editor.waitForFunction(()=>window.__studio.actors.Vale.velocity.length()===0);
  await editor.waitForFunction(()=>window.__studio.actors.Vale.layers[window.__studio.actors.Vale.idle].weight>.98);
  const rest=await actor();assert.ok(Math.hypot(rest.pos[0]-diagonal.pos[0],rest.pos[2]-diagonal.pos[2])<.18,'Stops promptly and blends back to idle');
  const canvas=editor.locator('canvas').first(),box=await canvas.boundingBox();
  const x=box.x+box.width*.5,y=box.y+box.height*.4;
  const yaw=await editor.evaluate(()=>window.__player.yaw);
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+120,y+40,{steps:12});await page.mouse.up({button:'right'});
  assert.ok(Math.abs(await editor.evaluate(()=>window.__player.yaw)-yaw)>.2);
  const beforeLook=await actor();assert.deepEqual(beforeLook.pos,rest.pos,'Mouse looking alone never translates the character');
  await page.keyboard.press('Space');
  await editor.waitForFunction(()=>window.__studio.actors.Vale.group.position.y>.25);
  await editor.waitForFunction(()=>!window.__studio.actors.Vale.jumpState);
  assert.equal((await actor()).pos[1],rest.pos[1]);
  await page.keyboard.down('KeyC');
  assert.equal(await editor.evaluate(()=>window.__studio.actors.Vale.crouch),undefined,'Unsupported crouch does not invent a gesture');
  await page.keyboard.up('KeyC');
  await editor.evaluate(()=>{const a=window.__studio.actors.Vale,clip=a.actions[a.idle].getClip().clone();clip.name='Crouch';a.actions.Crouch=a.mixer.clipAction(clip).play().setEffectiveWeight(0);a.layers.Crouch={time:0,weight:0};a.crouch=a.crouchWalk='Crouch';});
  await page.keyboard.down('KeyC');await editor.waitForFunction(()=>window.__studio.actors.Vale.layers.Crouch.weight>.9);
  await page.keyboard.up('KeyC');await editor.waitForFunction(()=>window.__studio.actors.Vale.layers[window.__studio.actors.Vale.idle].weight>.9);
  // Chromium's macOS automation rejects pointer lock; verify its usable
  // fallback here. Native capture is checked separately in the actual app.
  await canvas.click({position:{x:box.width*.5,y:box.height*.4}});
  await editor.waitForFunction(()=>document.pointerLockElement||document.querySelector('#toast').textContent.includes('Hold right mouse'));
  await page.keyboard.press('Escape');await editor.waitForFunction(()=>!document.pointerLockElement);
  await page.keyboard.press('Control+Shift+Digit3');
  await editor.waitForFunction(()=>window.__studio.camIndex===1&&window.__studio.controlMode==='camera');
  const fixed=await editor.evaluate(()=>({position:[...window.__scene.cameras[1].position],fov:window.__studio.camera.fov}));
  await page.mouse.move(x,y);await page.mouse.wheel(0,-400);
  await editor.waitForFunction(()=>window.__studio.history.pending===null&&window.__studio.camera.fov<55);
  assert.deepEqual(await editor.evaluate(()=>window.__scene.cameras[1].position),fixed.position,'Zoom changes framing without raising or moving the camera');
  await editor.locator('#undo').click();
  assert.equal(await editor.evaluate(()=>window.__studio.camera.fov),fixed.fov);
  await editor.locator('#redo').click();
  assert.ok(await editor.evaluate(()=>window.__studio.camera.fov)<fixed.fov);
  await page.keyboard.press('Control+Shift+Digit1');
  const freeStart=await editor.evaluate(()=>window.__studio.freeRig.pos.toArray());
  await page.keyboard.down('KeyW');await page.waitForTimeout(300);
  await page.keyboard.press('Control+Shift+Backquote');await page.keyboard.up('KeyW');
  const switched=await editor.evaluate(()=>window.__studio.freeRig.pos.toArray());
  assert.notDeepEqual(switched,freeStart);
  await page.waitForTimeout(300);
  assert.deepEqual(await editor.evaluate(()=>window.__studio.freeRig.pos.toArray()),switched,'Camera does not drift after switching to character');
  await editor.locator('#record-performance').click();
  await canvas.focus();await page.keyboard.press('Space');
  await editor.waitForFunction(()=>window.__studio.actors.Vale.group.position.y>.4);
  await editor.locator('#record-performance').click();
  assert.equal(await editor.evaluate(()=>window.__studio.actors.Vale.jumpState),null,'Stopping a take clears live jump physics');
  await editor.locator('#rewind').click();
  const floor=(await actor()).pos[1];
  await editor.evaluate(()=>window.__studio.timeline.seek(.2));
  assert.ok((await actor()).pos[1]>floor+.2,'A recorded jump replays from its timeline samples');
  assert.deepEqual(errors,[]);
  console.log('Passed: chat/editor shortcuts, number hints, precise diagonals, stopping/idle, mouse-only look, jump/landing, supported and unsupported crouch, capture fallback, fixed-camera zoom undo/redo, and no drift on switching.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
