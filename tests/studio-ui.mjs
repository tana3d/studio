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
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:event|unlisten') return;
        if (command === 'chatgpt_status') return { status: 'signed_in', email: 'test@example.com', error: null };
        if (command === 'chatgpt_models') return [{ slug: 'test-model', display_name: 'Test model' }];
        if (command === 'save_export') { window.testSaves.push(args); return true; }
        if (command === 'chatgpt_ask') {
          window.testRequests.push(args.request);
          args.onEvent.onmessage({ kind: 'delta', text: 'Try a low dolly shot.' });
          args.onEvent.onmessage({ kind: 'completed' });
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
  await page.getByRole('checkbox', { name: 'Include scene context' }).check();
  await page.getByRole('textbox', { name: 'Message ChatGPT' }).fill('What cameras are here?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.testRequests.length === 2);
  const requests = await page.evaluate(() => window.testRequests);
  assert.equal(requests[0].sceneContext, null, 'Scene context is opt-in');
  assert.deepEqual(requests[1].history.map(m => m.role), ['user', 'assistant']);
  assert.ok(JSON.parse(requests[1].sceneContext).scene.cameras.length);
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
  console.log('Studio: quarter-width chat, resizing/collapse without losing the scene or draft, streaming conversation/history, opt-in scene context, native save bridge, frame controls, and narrow window passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
