// Release bundles must sign the complete Python/bpy runtime, including native
// libraries; copying only the Python executable is not sufficient.
import { readdir, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(await readFile(join(root,'src-tauri/tauri.conf.json'),'utf8'));
const identity=process.env.APPLE_SIGNING_IDENTITY??config.bundle.macOS.signingIdentity;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);if(entry.isDirectory()){await walk(path);continue;}if(!entry.isFile())continue;
  const file=await open(path,'r');const header=Buffer.alloc(4);await file.read(header,0,4,0);await file.close();
  if(!['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex')))continue;
  const result=spawnSync('/usr/bin/codesign',['--force','--sign',identity,...(process.env.APPLE_KEYCHAIN_PATH?['--keychain',process.env.APPLE_KEYCHAIN_PATH]:[]),identity==='-'?'--timestamp=none':'--timestamp','--options','runtime',path],{stdio:'inherit'});
  if(result.error||result.status!==0)throw result.error??new Error('Converter signing failed.');
}}
await walk(join(root,'src-tauri/converter/runtime'));
