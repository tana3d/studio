import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (process.platform === 'darwin' && args[0] === 'dev' && !args.some(a => a === '--runner' || a === '-r')) {
  args.splice(1, 0, '--runner', join(root, 'scripts/cargo-signed-dev.mjs'));
}
const child = spawn(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
