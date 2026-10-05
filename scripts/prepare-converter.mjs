// Assemble a relocatable, version-pinned Python + Blender runtime. Never use a
// user's Python environment, and never commit the large generated binaries.
import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const targetArg=process.argv.indexOf('--target');
const target=targetArg<0?`${process.platform}-${process.arch}`:process.argv[targetArg+1];
const platforms={
  'darwin-x64':['x86_64-apple-darwin','macosx_11_0_x86_64'],
  'darwin-arm64':['aarch64-apple-darwin','macosx_11_0_arm64'],
  'linux-x64':['x86_64-unknown-linux-gnu','manylinux_2_28_x86_64'],
  'win32-x64':['x86_64-pc-windows-msvc','win_amd64'],
  'win32-arm64':['aarch64-pc-windows-msvc','win_arm64'],
};
const aliases=Object.fromEntries(Object.entries(platforms).map(([key,[triple]])=>[triple,key]));
const platform=aliases[target]??target, spec=platforms[platform];
if(!spec)throw new Error(`No prebuilt Blender converter is available for ${target}.`);
const rosettaIntel=process.platform==='darwin'&&process.arch==='arm64'&&platform==='darwin-x64';
if(platform!==`${process.platform}-${process.arch}`&&!rosettaIntel)throw new Error('Prepare the converter on the release target host; cross-platform pip installation is not supported.');
// Intel Python and bpy execute under Rosetta; every bundled binary remains Intel.
if(rosettaIntel)await new Promise((accept,reject)=>{const child=spawn('/usr/bin/arch',['-x86_64','/usr/bin/true']);child.on('error',reject);child.on('exit',code=>code===0?accept():reject(Error('Install Rosetta on the Apple Silicon build host before producing Intel releases.')));});
const version='4.5.14',release='20261003';
const destination=join(root,'src-tauri/converter/runtime');
const cached=await readFile(join(destination,'studio-runtime.json'),'utf8').then(JSON.parse).catch(()=>null);
if(cached?.platform===platform&&cached?.bpy===version&&cached?.release===release&&await access(join(destination,platform.startsWith('win32')?'python.exe':'bin/python3')).then(()=>true).catch(()=>false)&&!process.argv.includes('--force')){
  process.stdout.write('Bundled model converter is ready.\n');process.exit(0);
}
const staging=join(root,'.tmp/converter-runtime'),downloads=join(root,'.tmp/converter-downloads');
await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true});await mkdir(downloads,{recursive:true});
async function json(url){const response=await fetch(url);if(!response.ok)throw new Error(`Runtime metadata failed (${response.status}).`);return response.json();}
async function download(url,file,digest){
  if(!/^[a-f\d]{64}$/i.test(digest??''))throw new Error('A runtime download is missing its SHA-256 checksum.');
  const hashFile=async()=>{const hash=createHash('sha256');const {createReadStream}=await import('node:fs');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
  if(await hashFile().then(hash=>hash===digest).catch(()=>false))return;
  const response=await fetch(url);if(!response.ok)throw new Error(`Runtime download failed (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(file));
  if(await hashFile()!==digest){await rm(file,{force:true});throw new Error('Runtime download checksum did not match.');}
}
async function run(command,args,env=process.env){await new Promise((accept,reject)=>{const child=spawn(command,args,{stdio:'inherit',env});child.on('error',reject);child.on('exit',code=>code===0?accept():reject(new Error(`Runtime preparation failed (${code}).`)));});}
const metadata=await json(`https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/${release}`);
const python=metadata.assets.find(a=>a.name.startsWith('cpython-3.11.')&&a.name.endsWith(`${spec[0]}-install_only_stripped.tar.gz`));
if(!python)throw new Error('The pinned Python build is unavailable.');
let pythonHash=python.digest?.replace(/^sha256:/,'');
if(!pythonHash){const response=await fetch(`${python.browser_download_url}.sha256`);if(!response.ok)throw new Error('Python checksum is unavailable.');pythonHash=(await response.text()).trim().split(/\s/)[0];}
process.stdout.write(`Preparing local model converter: Python 3.11 + Blender ${version} (${platform}).\n`);
const archive=join(downloads,python.name);await download(python.browser_download_url,archive,pythonHash);
await run('tar',['-xzf',archive,'--strip-components=1','-C',staging]);
const packageMetadata=await json(`https://pypi.org/pypi/bpy/${version}/json`);
const wheel=packageMetadata.urls.find(f=>f.filename.includes('cp311-cp311')&&f.filename.includes(spec[1]));
if(!wheel)throw new Error('The Blender package is unavailable for this platform.');
const wheelFile=join(downloads,wheel.filename);await download(wheel.url,wheelFile,wheel.digests.sha256);
const executable=join(staging,platform.startsWith('win32')?'python.exe':'bin/python3');
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('PYTHON')||key.startsWith('PIP'))delete env[key];
await run(executable,['-I','-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--no-compile',wheelFile],env);
await run(executable,['-I','-c',"import bpy; assert hasattr(bpy.ops.export_scene, 'gltf'); print('Blender converter:', bpy.app.version_string)"],env);
await writeFile(join(staging,'studio-runtime.json'),JSON.stringify({schema:1,platform,bpy:version,release,python:python.name,pythonSha256:pythonHash,bpySha256:wheel.digests.sha256,source:`https://download.blender.org/source/blender-${version}.tar.xz`},null,2));
await rm(destination,{recursive:true,force:true});
const {rename}=await import('node:fs/promises');await rename(staging,destination);
process.stdout.write('Local model converter prepared and verified.\n');
