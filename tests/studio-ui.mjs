import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

// Test the packaged static output without touching either dev server.
const root = resolve('out');
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '/') && path !== root) { res.writeHead(403).end(); return; }
  try {
    const file = path.endsWith('/') || !extname(path) ? path + '/index.html' : path;
    if(new URL(req.url,'http://localhost').pathname==='/studio/test-three.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(await readFile('node_modules/three/build/three.module.js'));return;}
    if(new URL(req.url,'http://localhost').pathname==='/studio/three.core.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(await readFile('node_modules/three/build/three.core.js'));return;}
    const body = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' }[extname(file)];
    res.writeHead(200, { 'Content-Type': mime ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 0.5 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.devicePixelRatio = 0.5;
    if (window.parent !== window) return;
    window.isTauri = true;
    window.testRequests = [];
    window.testSaves = [];
    window.testLibrary=new Map();window.testCatalogCalls=[];window.testLibraryReads=0;window.testFolderOpened=false;window.testCatalogWindowOpens=0;
    window.testCallbacks = new Map(); window.testAccountReads = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: callback => { const id = window.testCallbacks.size + 1; window.testCallbacks.set(id, callback); return id; },
      invoke: async (command, args) => {
        if(command==='library_list')return{root:'/Users/test/Documents/TanaStudio/Library',assets:[...window.testLibrary.values()],skipped:0};
        if(command==='library_catalog'){
          window.testCatalogCalls.push(args);
          const assets=[{id:'fixture-object',downloads:42,name:'Oak Table',category:'props',description:'An oak dining table.',tags:['wood','table','interior'],creator:'Model creator',license:'CC0',source_url:'https://example.com/model',license_url:'https://creativecommons.org/publicdomain/zero/1.0/',model_key:'assets/test/model.glb',poster_key:'assets/test/preview.png',animations:[]}, {id:'fixture-character',name:'Animated Performer',category:'characters',description:'A walking character.',tags:['human','animated'],creator:'Model creator',license:'CC0',source_url:'https://example.com/model',license_url:'https://creativecommons.org/publicdomain/zero/1.0/',poster_key:'assets/test/preview.png',animations:['Walk']}];
          return {assets:assets.filter(a=>(!args.category||a.category===args.category)&&(!args.q||a.name.toLowerCase().includes(args.q.toLowerCase()))),total:48,page:args.page,pages:2};
        }
        if(command==='library_download'){
          await new Promise(resolve=>{window.finishTestDownload=resolve;});
          const item={id:args.id,name:args.id==='fixture-object'?'Oak Table':'Animated Performer',category:args.id==='fixture-object'?'props':'characters',tags:['wood'],animations:['Walk'],catalog:{creator:'Model creator',license:'CC0',downloads:43,poster_key:'assets/test/preview.png'}};
          window.testLibrary.set(item.id,item);return item;
        }
        if(command==='library_read'){window.testLibraryReads++;const data=await(await fetch('/studio/assets/performer.glb')).arrayBuffer();let binary='';for(const byte of new Uint8Array(data))binary+=String.fromCharCode(byte);return btoa(binary);}
        if(command==='library_measure')return;
        if(command==='library_preview')return null;
        if(command==='library_open_browser'){window.testCatalogWindowOpens++;return;}
        if(command==='library_close_browser')return;
        if(command==='library_import'){const item={id:'fixture-import',name:args.name.replace(/\.glb$/i,''),category:args.category,tags:[],animations:['Walk'],catalog:null};window.testLibrary.set(item.id,item);return item;}
        if(command==='library_pick_import')return new Promise(resolve=>{window.finishTestImport=()=>{const asset={id:'fixture-converted',name:'Converted Blender model',category:args.category,tags:[],animations:['Walk'],catalog:null};window.testLibrary.set(asset.id,asset);resolve({asset,warnings:[]});};});
        if(command==='library_cancel_import'){window.testCancelled=true;window.finishTestImport=null;window.cancelTestImport?.();return;}
        if(command==='library_open_folder'){window.testFolderOpened=true;return;}
        if (command === 'plugin:event|listen') { window.testAccountChanged = () => window.testCallbacks.get(args.handler)({ event: 'chatgpt-changed', id: 1, payload: null }); return 1; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'chatgpt_status') { window.testAccountReads++; return { status: 'signed_in', email: 'test@example.com', error: null }; }
        if (command === 'chatgpt_models') return [{ slug: 'test-model', display_name: 'Test model' }];
        if (command === 'save_export') { window.testSaves.push(args); return true; }
        if (command === 'chatgpt_ask') {
          window.testRequests.push(args.request);
          if (args.request.question === 'Empty response') { args.onEvent.onmessage({ kind: 'completed', output: [] }); return; }
          if (args.request.question === 'Add a traffic cone' && !args.request.continuation.length) {
            args.onEvent.onmessage({ kind: 'completed', output: [{ type: 'function_call', namespace: 'studio', name: 'apply_action', call_id: 'cone_call', arguments: JSON.stringify({ type: 'place_asset', payload: JSON.stringify({ asset_id: 'cone', anchor: 'camera_foreground', rotation_y: 0 }) }) }] });
            return;
          }
          if (args.request.question === 'Add a traffic cone') {
            args.onEvent.onmessage({ kind: 'delta', text: 'Added a traffic cone in front of the camera.' });
            args.onEvent.onmessage({ kind: 'completed', output: [] }); return;
          }
          args.onEvent.onmessage({ kind: 'delta', text: 'Try a low dolly shot.' });
          args.onEvent.onmessage({ kind: 'completed', output: [] });
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    window.__TAURI__ = { core: { invoke: window.__TAURI_INTERNALS__.invoke },event:{listen:async(name,callback)=>{window.testEvents??={};window.testEvents[name]=callback;return()=>delete window.testEvents[name];}} };
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  const editor = page.frames().find(frame => frame.url().includes('/studio/index.html'));
  assert.ok(editor, 'The editor is embedded');
  await editor.waitForFunction(() => window.__studio?.ready);
  const chatBox = await page.locator('.chat-pane').boundingBox();
  const editorBox = await page.locator('.editor-pane').boundingBox();
  assert.equal(chatBox.width, 375); assert.equal(editorBox.width, 1125);
  await editor.evaluate(() => { window.layoutScene = window.__scene; });
  await page.getByRole('textbox', { name: 'Message ChatGPT' }).fill('Keep this draft');
  const divider = page.getByRole('separator', { name: 'Resize chat panel' });
  const dividerBox = await divider.boundingBox();
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, 400);
  await page.mouse.down(); await page.mouse.move(450, 400, { steps: 8 }); await page.mouse.up();
  assert.equal((await page.locator('.chat-pane').boundingBox()).width, 450);
  assert.equal(await page.locator('.panel-drag-shield').count(), 0);
  await page.getByRole('button', { name: 'Collapse chat' }).click();
  assert.equal(await page.locator('.chat-pane').isVisible(), false);
  assert.equal((await page.locator('.editor-pane').boundingBox()).width, 1500);
  await page.getByRole('button', { name: 'Open chat' }).click();
  assert.equal((await page.locator('.chat-pane').boundingBox()).width, 450);
  assert.equal(await page.getByRole('textbox', { name: 'Message ChatGPT' }).inputValue(), 'Keep this draft');
  assert.equal(await editor.evaluate(() => window.__scene === window.layoutScene), true, 'Resizing/collapsing keeps the live scene mounted');
  await divider.focus(); await page.keyboard.press('Home');
  assert.equal((await page.locator('.chat-pane').boundingBox()).width, 375);
  await page.getByRole('textbox', { name: 'Message ChatGPT' }).fill('Plan my opening shot');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Try a low dolly shot.').waitFor();
  assert.equal(await page.getByRole('checkbox').count(), 0);
  const accountReads = await page.evaluate(() => window.testAccountReads);
  await page.evaluate(() => window.testAccountChanged());
  await page.waitForFunction(count => window.testAccountReads > count, accountReads);
  assert.equal(await page.getByRole('combobox', { name: 'ChatGPT model' }).inputValue(), 'test-model', 'Null sign-in notifications refresh account status without crashing');
  await page.getByRole('textbox', { name: 'Message ChatGPT' }).fill('What cameras are here?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.testRequests.length === 2);
  const requests = await page.evaluate(() => window.testRequests);
  assert.ok(JSON.parse(requests[0].sceneContext).rixse.wire.includes(' cone '), 'Scene and library are always supplied');
  assert.ok(requests[0].sceneImage.startsWith('data:image/jpeg;base64,'), 'Current camera view is sent as a separate image');
  const cameraImage = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    return { width: image.width, height: image.height, lit: pixels.some((p,i) => i%4 !== 3 && p > 20) };
  }, requests[0].sceneImage);
  assert.ok(cameraImage.lit && cameraImage.width <= 1024 && cameraImage.height <= 1024, 'Snapshot contains the rendered scene within the image budget');
  assert.deepEqual(requests[1].history.map(m => m.role), ['user', 'assistant']);
  assert.ok(JSON.parse(requests[1].sceneContext).cameras.length);
  const initial = await editor.evaluate(() => ({ props: window.__scene.environment.props.length, cameras: JSON.stringify(window.__studio.cameraEdit.shots), timeline: JSON.stringify(window.__studio.timeline.items) }));
  await page.getByRole('textbox', { name: 'Message ChatGPT' }).fill('Add a traffic cone');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Added a traffic cone in front of the camera.').waitFor();
  const cone = await editor.evaluate(() => window.__scene.environment.props.find(p => p.type === 'cone'));
  assert.ok(cone?.id); assert.deepEqual(cone.position, [0,0,2]);
  assert.equal(await editor.evaluate(() => window.__scene.environment.props.length), initial.props + 1);
  const followup = await page.evaluate(() => window.testRequests.at(-1));
  assert.ok(followup.continuation.some(item => item.type === 'function_call_output' && JSON.parse(item.output).ok));
  const coneHandle = await editor.evaluate(id => window.__studio.rixse.wire.handle('object', id), cone.id);
  assert.ok(JSON.parse(followup.sceneContext).rixse.wire.includes(coneHandle), 'Agent continuation sees its actual edit');
  assert.equal(await editor.evaluate(() => window.__studio.history.past.at(-1).store.log.at(-1).author), 'agent');
  await editor.locator('#undo').click();
  assert.equal(await editor.evaluate(() => window.__scene.environment.props.length), initial.props);
  await editor.locator('#redo').click();
  assert.equal(await editor.evaluate(() => window.__scene.environment.props.at(-1).id), cone.id);
  const rejected = await editor.evaluate(() => window.studioAgent.executeTool('apply_action', { type: 'place_asset', payload: JSON.stringify({ asset_id: 'cone', x: 0, y: 0, z: 2, rotation_y: 0 }) }));
  assert.equal(rejected.ok, false, 'Overlapping placement is rejected');
  assert.equal(await editor.evaluate(() => window.__scene.environment.props.length), initial.props + 1);
  const moved = await editor.evaluate(id => window.studioAgent.executeTool('apply_action', { type: 'move_prop', payload: JSON.stringify({ object_id: id, x: 1, y: 0, z: 2, rotation_y: .5 }) }), cone.id);
  assert.equal(moved.ok, true); assert.deepEqual(moved.position, [1,0,2]);
  await editor.locator('#undo').click();
  assert.deepEqual(await editor.evaluate(() => window.__scene.environment.props.find(p => p.type === 'cone').position), [0,0,2]);
  const deleted = await editor.evaluate(id => window.studioAgent.executeTool('apply_action', { type: 'delete_prop', payload: JSON.stringify({ object_id: id }) }), cone.id);
  assert.equal(deleted.ok, true); await editor.locator('#undo').click();
  assert.equal(await editor.evaluate(() => JSON.stringify(window.__studio.cameraEdit.shots)), initial.cameras);
  assert.equal(await editor.evaluate(() => JSON.stringify(window.__studio.timeline.items)), initial.timeline);
  const lampClick = await editor.evaluate(() => {
    const index = window.__scene.environment.props.findIndex(p => p.type === 'streetlamp');
    const group = window.__studio.scene.children.find(g => g.userData.objectId === window.__scene.environment.props[index].id);
    const point = group.position.clone(); point.y += 1.5; point.project(window.__studio.camera);
    const bounds = window.__studio.renderer.domElement.getBoundingClientRect();
    return { x: (point.x + 1)/2*bounds.width, y: (1-point.y)/2*bounds.height, id: window.__scene.environment.props[index].id };
  });
  await editor.locator('canvas').first().click({ position: { x: lampClick.x, y: lampClick.y } });
  const selectedLamp = await editor.evaluate(() => window.studioContext().selection);
  assert.equal(selectedLamp.object, await editor.evaluate(id => window.__studio.rixse.wire.handle('object', id), lampClick.id), 'Click selection gives this light a concrete Rixse referent');
  assert.ok(selectedLamp.anchor);
  const beside = await editor.evaluate(anchor => window.studioAgent.executeTool('apply_action', { type: 'place_asset', payload: JSON.stringify({ asset_id: 'cone', anchor, dx: .8 }) }), selectedLamp.anchor);
  assert.equal(beside.ok, true); assert.ok(Math.abs(beside.position[0] + 2.4) < 1e-6); assert.deepEqual(beside.position.slice(1), [0,-10]);
  await editor.locator('#undo').click();
  const performer = await editor.evaluate(async () => {
    window.__studio.timeline.mode = 'paused';
    return window.__studio.rixse.dispatch({ type: 'place_asset', payload: { asset_id: 'performer', anchor: 'near_character' } }, 'you');
  });
  assert.equal(performer.ok, true, 'Human and agent additions share the Rixse action, including in review');
  assert.equal(await editor.evaluate(name => window.__studio.actors[name].present, performer.name), true);
  await editor.locator('#undo').click();
  assert.equal(await editor.evaluate(name => window.__studio.actors[name].present, performer.name), false);
  await editor.locator('#redo').click();
  assert.equal(await editor.evaluate(name => window.__studio.actors[name].present, performer.name), true);
  await editor.evaluate(() => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['Studio test export']));
    link.download = 'scene-video-1.mp4'; document.body.append(link); link.click(); link.remove();
  });
  await page.waitForFunction(() => window.testSaves.length === 1);
  const save = await page.evaluate(() => window.testSaves[0]);
  assert.equal(save.name, 'scene-video-1.mp4');
  assert.equal(Buffer.from(save.data, 'base64').toString(), 'Studio test export');
  assert.equal(await editor.getByRole('button', { name: 'Split at playhead' }).count(), 1);
  assert.equal(await editor.getByRole('button', { name: 'Export video ↗', exact: true }).count(), 1);
  await editor.getByRole('tab', { name: 'Library', exact: true }).click();
  assert.equal(await editor.locator('#asset-list').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
  await editor.getByRole('tab', { name: 'Direct the action' }).click();
  await editor.locator('#frame-format').selectOption('portrait');
  assert.ok(Math.abs(await editor.evaluate(() => window.__studio.camera.aspect) - 9 / 16) < 0.001);
  await editor.locator('#undo').click();
  assert.ok(Math.abs(await editor.evaluate(() => window.__studio.camera.aspect) - 16 / 9) < 0.001);
  await editor.getByRole('tab',{name:'Library',exact:true}).click();
  await editor.locator('#browse-catalog').click();
  assert.equal(await page.evaluate(()=>window.testCatalogWindowOpens),1,'Desktop catalog opens a separate window');
  await editor.evaluate(()=>window.__studio.library.open({separate:false}));
  await editor.locator('#catalog-grid .catalog-card').first().waitFor();
  assert.equal(await editor.locator('#catalog-grid .catalog-card').count(),2);
  assert.equal(await editor.locator('#catalog-grid').getAttribute('aria-busy'),'false');
  assert.equal(await editor.locator('#catalog-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),4);
  await editor.locator('.catalog-downloads').filter({hasText:'42 downloads'}).waitFor();
  const modal=editor.locator('#catalog-dialog'),initialModal=await modal.boundingBox(),handle=await editor.locator('#catalog-resize').boundingBox();
  assert.ok(initialModal.width>1000,'Catalog starts wider than the old 950px modal');
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-220,handle.y+handle.height/2-160,{steps:8});await page.mouse.up();
  const resized=await modal.boundingBox();assert.ok(Math.abs(resized.width-(initialModal.width-220))<3);assert.ok(Math.abs(resized.height-(initialModal.height-160))<3);
  await editor.locator('#catalog-resize').focus();await page.keyboard.press('ArrowRight');assert.ok(Math.abs((await modal.boundingBox()).width-resized.width-32)<3);
  assert.ok(await editor.locator('.catalog-footer').isVisible(),'Navigation remains visible while resizing');
  await editor.locator('#catalog-search').fill('Oak');
  await page.waitForFunction(()=>window.testCatalogCalls.at(-1)?.q==='Oak');
  await editor.locator('#catalog-grid').getByRole('button',{name:'Add to collection'}).click();
  const progress=editor.locator('[data-asset="fixture-object"] .catalog-progress');
  await progress.waitFor({state:'visible'});
  await page.evaluate(()=>window.testEvents['library-download-progress']({payload:{id:'fixture-object',stage:'downloading',label:'Downloading…',percent:40}}));
  assert.equal(await progress.getAttribute('value'),'40');
  await page.evaluate(()=>window.testEvents['library-download-progress']({payload:{id:'fixture-object',stage:'converting',label:'Converting the model on your computer…',percent:null}}));
  assert.equal(await progress.getAttribute('value'),null,'Conversion progress is indeterminate');
  await editor.getByRole('button',{name:'Converting…',exact:true}).waitFor();
  await page.evaluate(()=>window.finishTestDownload());
  await editor.getByRole('button',{name:'In your collection',exact:true}).waitFor();
  assert.equal(await progress.isVisible(),false);
  await editor.locator('.catalog-downloads').filter({hasText:'43 downloads'}).waitFor();
  assert.equal(await page.evaluate(()=>window.testLibraryReads),0,'Downloading registers metadata without loading unused models');
  await editor.locator('#collection-folder').click();assert.equal(await page.evaluate(()=>window.testFolderOpened),true);
  await editor.locator('#catalog-search').fill('');
  await editor.locator('#catalog-category').selectOption('characters');
  await page.waitForFunction(()=>window.testCatalogCalls.at(-1)?.category==='characters');
  await editor.getByRole('heading',{name:'Animated Performer',exact:true}).waitFor();
  assert.equal(await editor.getByRole('heading',{name:'Oak Table',exact:true}).count(),0);
  await editor.locator('#catalog-next').click();await page.waitForFunction(()=>window.testCatalogCalls.at(-1)?.page===2);
  await editor.locator('#catalog-category').selectOption('');await editor.getByRole('heading',{name:'Oak Table',exact:true}).waitFor();
  const cameraBefore=await editor.evaluate(()=>window.__studio.camIndex);
  await editor.locator('#catalog-next').focus();await page.keyboard.press('f');assert.equal(await editor.evaluate(()=>window.__studio.camIndex),cameraBefore,'Catalog input never moves the camera');
  await page.keyboard.press('Escape');assert.equal(await editor.locator('#catalog-dialog').isVisible(),false);
  assert.equal(await editor.locator('#browse-catalog').evaluate(el=>el===document.activeElement),true);
  const downloaded=await editor.evaluate(()=>window.__studio.rixse.dispatch({type:'place_asset',payload:{asset_id:'fixture-object',anchor:'camera_foreground'}},'you'));
  assert.equal(downloaded.ok,true);assert.equal(await page.evaluate(()=>window.testLibraryReads),1,'Placement lazily reads the saved GLB');
  await editor.locator('#undo').click();assert.equal(await editor.locator('#asset-list [data-asset="fixture-object"]').count(),1,'Undo preserves the personal collection');
  await editor.locator('#redo').click();assert.equal(await page.evaluate(()=>window.testLibraryReads),1,'Redo reuses the loaded model');
  await editor.locator('#undo').click();
  await editor.goto(editor.url());await editor.waitForFunction(()=>window.__studio?.library?.saved.has('fixture-object'));
  assert.equal(await page.evaluate(()=>window.testLibraryReads),1,'Restart restores metadata without eagerly parsing saved models');
  assert.equal(await editor.locator('#asset-list [data-asset="fixture-object"]').count(),1);
  await editor.locator('#model-file').setInputFiles('editor/assets/performer.glb');
  await editor.locator('[data-asset="fixture-import"]').waitFor();
  assert.equal(await page.evaluate(()=>window.testLibraryReads),1,'User imports validate before saving and do not reread the file');
  assert.equal(await page.evaluate(()=>window.testLibrary.get('fixture-import').name),'performer','User imports join the persistent collection');
  await editor.locator('#import-model').click();
  assert.equal(await editor.locator('#import-progress-panel').isVisible(),true);
  assert.equal(await editor.locator('#import-progress').getAttribute('value'),null,'Conversion does not invent a completion percentage');
  assert.equal(await editor.locator('#import-model').isDisabled(),true);
  await page.evaluate(()=>window.testEvents['library-import-progress']({payload:'Converting model and textures…'}));
  assert.equal(await editor.locator('#import-status').textContent(),'Converting model and textures…');
  await page.evaluate(()=>window.finishTestImport());
  await editor.locator('[data-asset="fixture-converted"]').waitFor();
  await editor.waitForFunction(()=>document.getElementById('import-progress-panel').hidden);
  assert.equal(await editor.locator('#import-model').isEnabled(),true);
  // A real animated robot can emote, record it, and replay the same pose.
  const robot=await editor.evaluate(()=>window.__studio.rixse.dispatch({type:'place_asset',payload:{asset_id:'robot',x:1.8,y:0,z:2}},'you'));
  assert.equal(robot.ok,true);
  await editor.getByRole('tab',{name:'Direct the action'}).click();
  await editor.locator('#record-performance').click();await editor.locator('#gesture-select').selectOption('Wave');
  await editor.waitForFunction(()=>window.__studio.timeline.time>1.2);
  await editor.locator('#record-performance').click();
  const emote=await editor.evaluate(()=>{
    const actor=window.__studio.actors[document.getElementById('actor-select').value];
    const bones=()=>{const a=[];actor.group.traverse(o=>{if(o.isBone)a.push(...o.quaternion.toArray());});return a;};
    window.__studio.timeline.seek(.4);const early=bones();window.__studio.timeline.seek(.9);const later=bones();window.__studio.timeline.seek(.4);const rewind=bones();
    return {early,later,rewind,frames:window.__studio.timeline.items.at(-1).frames.length};
  });
  assert.ok(emote.frames>60);assert.notDeepEqual(emote.early,emote.later,'Wave changes the actual skeletal pose');assert.deepEqual(emote.early,emote.rewind,'Seeking reproduces the emote pose');
  await editor.locator('#live-mode').click();await editor.getByRole('tab',{name:'Library',exact:true}).click();
  await editor.locator('[data-tab="scenes"]').click();
  assert.deepEqual(await editor.locator('#catalog-category option').evaluateAll(options=>options.map(o=>o.value)),['','props','characters','scenes']);
  // Import a real GLB as a set. Its mesh pieces remain editable and undo restores the entire previous environment.
  const previousSet=await editor.evaluate(()=>JSON.stringify(window.__scene.environment));
  // Skinned models belong in Characters; a static set fixture uses a box with actual geometry.
  const sceneResult=await editor.evaluate(async()=>{
    const THREE=await import('/studio/test-three.js');
    const source=new THREE.Group();const box=new THREE.Mesh(new THREE.BoxGeometry(4,3,2),new THREE.MeshStandardMaterial());box.position.set(2,1.5,1);box.name='Set wall';source.add(box);
    window.__studio.useSceneAsset({id:'test-set',name:'Test set',gltf:{scene:source}});
    return {custom:window.__scene.environment.customSet,parts:window.__scene.environment.props.length,bounds:window.__scene.environment.bounds};
  });
  assert.equal(sceneResult.custom,true);assert.equal(sceneResult.parts,1);assert.ok(sceneResult.bounds[1][0]>=10);
  // Character mode captures mouse look; switch to camera/editing before sizing set pieces.
  await editor.locator('#mode-camera').click();
  const modelId=await editor.evaluate(()=>window.__scene.environment.props[0].id);
  const resize=await editor.evaluate(id=>window.__studio.rixse.dispatch({type:'resize_prop',payload:{object_id:id,scale:1.5}},'you'),modelId);
  assert.equal(resize.ok,true);assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),1.5);
  const selectPoint=await editor.evaluate(()=>window.__project(2,2.25,1));
  const iframeBox=await page.locator('iframe').boundingBox();await page.mouse.click(iframeBox.x+selectPoint[0],iframeBox.y+selectPoint[1]);
  await editor.locator('#model-inspector').waitFor({state:'visible'});await editor.locator('#model-size').fill('200');await editor.locator('#model-size').press('Tab');
  assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),2);
  await editor.locator('#model-depth').fill('20');await editor.locator('#model-depth').press('Tab');
  assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),10,'Metre dimensions can enlarge a model beyond scene boundaries');
  await editor.locator('#undo').click();assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),2);
  await editor.locator('#undo').click();assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),1.5);
  await editor.locator('#redo').click();assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),2);
  await editor.locator('#model-size-reset').click();assert.equal(await editor.evaluate(()=>window.__scene.environment.props[0].scale),1);
  await editor.locator('#undo').click();await editor.locator('#undo').click();await editor.locator('#undo').click();
  await editor.locator('#undo').click();assert.equal(await editor.evaluate(()=>JSON.stringify(window.__scene.environment)),previousSet);
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: '.tmp/studio-desktop.png' });
  await page.setViewportSize({ width: 1100, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1100);
  assert.equal(await editor.evaluate(() => document.documentElement.scrollWidth), 825);
  await page.getByRole('textbox', { name: 'Message ChatGPT' }).fill('Empty response');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'completed without a reply or scene action' }).waitFor();
  assert.equal(await page.getByText('Thinking…', { exact: true }).count(), 0, 'An empty completed response never stays stuck at Thinking');
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('heading', { name: 'A world for your story.' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Studio: quarter-width chat, resizing/collapse without losing the scene or draft, streaming conversation/history, automatic Rixse scene context/actions and undo/redo, native save bridge, frame controls, and narrow window passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
