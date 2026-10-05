import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { notarizationEnv } from './notarization-env.mjs';
import { linuxBundleEnv } from './linux-bundle-env.mjs';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if(['dev','build'].includes(args[0])){
  const target=args.indexOf('--target');
  await new Promise((accept,reject)=>{
    const preparation=spawn(process.execPath,[join(root,'scripts/prepare-converter.mjs'),...(target>=0?['--target',args[target+1]]:[])],{stdio:'inherit'});
    preparation.on('error',reject);preparation.on('exit',code=>code===0?accept():reject(new Error('Could not prepare the bundled model converter.')));
  });
}
if(process.platform==='darwin'&&args[0]==='build'){
  await new Promise((accept,reject)=>{
    const signing=spawn(process.execPath,[join(root,'scripts/sign-converter.mjs')],{stdio:'inherit'});
    signing.on('error',reject);signing.on('exit',code=>code===0?accept():reject(new Error('Could not sign the bundled converter.')));
  });
}
if (process.platform === 'darwin' && args[0] === 'dev' && !args.some(a => a === '--runner' || a === '-r')) {
  args.splice(1, 0, '--runner', join(root, 'scripts/cargo-signed-dev.mjs'));
}
let environment = notarizationEnv(process.env);
if (process.platform === 'linux' && args[0] === 'build') {
  const runtime = join(root, 'src-tauri/converter/runtime');
  const metadata = JSON.parse(await readFile(join(runtime, 'studio-runtime.json'), 'utf8'));
  environment = linuxBundleEnv(environment, runtime, metadata.bpy);
}
const child = spawn(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...args], { stdio: 'inherit', env: environment });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
