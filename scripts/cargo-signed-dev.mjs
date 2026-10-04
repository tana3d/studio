#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tauri's runner receives cargo run arguments. Build first, sign with a stable
// designated identity, then start the native process. Every Rust rebuild follows
// this path, so Keychain does not see a new unsigned executable each time.
const args = process.argv.slice(2);
const run = (command, argv, options = {}) => {
  const result = spawnSync(command, argv, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
};
if (args[0] !== 'run' || process.platform !== 'darwin') {
  run('cargo', args); process.exit(0);
}
const separator = args.indexOf('--');
const buildArgs = ['build', ...args.slice(1, separator < 0 ? undefined : separator)];
const appArgs = separator < 0 ? [] : args.slice(separator + 1);
run('cargo', buildArgs);
const metadataArgs = ['metadata', '--no-deps', '--format-version', '1'];
const manifest = buildArgs.indexOf('--manifest-path');
if (manifest >= 0) metadataArgs.push('--manifest-path', buildArgs[manifest + 1]);
const metadata = JSON.parse(run('cargo', metadataArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout);
const targetIndex = buildArgs.indexOf('--target'), profileIndex = buildArgs.indexOf('--profile');
const target = targetIndex >= 0 ? buildArgs[targetIndex + 1] : process.env.CARGO_BUILD_TARGET;
const profile = profileIndex >= 0 ? buildArgs[profileIndex + 1] : buildArgs.includes('--release') ? 'release' : 'debug';
const binary = join(metadata.target_directory, ...(target ? [target] : []), profile === 'dev' ? 'debug' : profile, 'tana-studio');
const config = JSON.parse(readFileSync(fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'));
const identity = process.env.APPLE_SIGNING_IDENTITY || config.bundle.macOS.signingIdentity;
run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', config.identifier, '--timestamp=none', binary]);
run('/usr/bin/codesign', ['--verify', '--strict', binary]);
process.stderr.write('Studio development binary signed and verified.\n');
const child = spawn(binary, appArgs, { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
