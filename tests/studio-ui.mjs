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
    window.testCallbacks = new Map(); window.testAccountReads = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: callback => { const id = window.testCallbacks.size + 1; window.testCallbacks.set(id, callback); return id; },
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') { window.testAccountChanged = () => window.testCallbacks.get(args.handler)({ event: 'chatgpt-changed', id: 1, payload: null }); return 1; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'chatgpt_status') { window.testAccountReads++; return { status: 'signed_in', email: 'test@example.com', error: null }; }
        if (command === 'chatgpt_models') return [{ slug: 'test-model', display_name: 'Test model' }];
        if (command === 'save_export') { window.testSaves.push(args); return true; }
        if (command === 'chatgpt_ask') {
          window.testRequests.push(args.request);
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
    window.__TAURI__ = { core: { invoke: window.__TAURI_INTERNALS__.invoke } };
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
  await mkdir('.tmp', { recursive: true });
  await page.screenshot({ path: '.tmp/studio-desktop.png' });
  await page.setViewportSize({ width: 1100, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1100);
  assert.equal(await editor.evaluate(() => document.documentElement.scrollWidth), 825);
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('heading', { name: 'A world for your story.' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Studio: quarter-width chat, resizing/collapse without losing the scene or draft, streaming conversation/history, automatic Rixse scene context/actions and undo/redo, native save bridge, frame controls, and narrow window passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
