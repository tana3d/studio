import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

export const platforms = {
  'darwin-arm64': {label:'macOS Apple Silicon',extension:'.dmg'},
  'darwin-x64': {label:'macOS Intel',extension:'.dmg'},
  'win32-x64': {label:'Windows',extension:'.exe'},
  'linux-x64': {label:'Linux',extension:'.AppImage'},
};
export async function digest(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
export async function walk(directory) {
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await walk(path));
    else if(entry.isFile())files.push(path);
  }
  return files;
}
export function releaseIdentity(env) {
  const number=Number(env.GITHUB_RUN_NUMBER),attempt=Number(env.GITHUB_RUN_ATTEMPT??1);
  if(!Number.isSafeInteger(number)||number<1||!Number.isSafeInteger(attempt)||attempt<1||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw Error('Invalid release identity.');
  const [major,minor]=env.STUDIO_BASE_VERSION.split('.');
  if(!/^\d+$/.test(major)||!/^\d+$/.test(minor))throw Error('Invalid base version.');
  return {schema:1,version:`${major}.${minor}.${number}`,buildNumber:number,buildId:`${number}-${attempt}-${env.GITHUB_SHA.slice(0,12)}`,commit:env.GITHUB_SHA};
}
export async function describeFile(file,identity,platform=null) {
  const name=platform?`Studio-${platform}${platforms[platform].extension}`:basename(file);
  if(!/^[\w.-]+$/.test(name))throw Error('Unsafe release filename.');
  const bytes=(await stat(file)).size;
  if(!bytes)throw Error('Empty release artifact.');
  const key=`releases/${identity.buildId}/${name}`;
  return {platform,label:platform?platforms[platform].label:name,key,url:`https://tana.gg/downloads/${key}`,bytes,sha256:await digest(file),filename:name};
}
export function selectInstaller(paths,identity,platform) {
  const matches=paths.filter(path=>basename(path).toLowerCase().startsWith(`Studio_${identity.version}_`.toLowerCase())&&path.toLowerCase().endsWith(platforms[platform].extension.toLowerCase()));
  if(matches.length!==1)throw Error(`Expected exactly one ${platform} installer for ${identity.version}, found ${matches.length}.`);
  return matches[0];
}
export async function assembleRelease(directory,identity) {
  const paths=await walk(directory),files=[],sources=[];
  for(const [platform,spec]of Object.entries(platforms)) {
    const metadata=paths.filter(path=>basename(path)===`${platform}.json`);
    if(metadata.length!==1)throw Error(`Missing or duplicate ${platform} release metadata.`);
    const {readFile}=await import('node:fs/promises');
    const record=JSON.parse(await readFile(metadata[0],'utf8'));
    if(record.buildId!==identity.buildId||record.commit!==identity.commit||record.version!==identity.version||record.file.platform!==platform)throw Error('Mixed release builds are not allowed.');
    const payload=paths.filter(path=>basename(path)===record.file.filename);
    if(payload.length!==1)throw Error(`Missing or duplicate ${platform} installer.`);
    const actual=await describeFile(payload[0],identity,platform);
    if(actual.sha256!==record.file.sha256||actual.bytes!==record.file.bytes)throw Error(`Corrupt ${platform} artifact.`);
    files.push({...actual,path:payload[0]});
  }
  for(const name of ['blender-4.5.14.tar.xz','studio-source.tar.gz']) {
    const matches=paths.filter(path=>basename(path)===name);
    if(matches.length!==1)throw Error(`Missing corresponding source: ${name}.`);
    sources.push({...await describeFile(matches[0],identity),path:matches[0]});
  }
  return {...identity,publishedAt:new Date().toISOString(),files,sources};
}
// Only advance the public pointer after every payload is read back and checked.
// The conditional pointer write also protects against concurrent publishers.
export async function publishRelease(store,release,isCurrent) {
  const current=await store.readManifest();
  if(current.manifest?.buildNumber>release.buildNumber)throw Error('A newer release is already published.');
  if(!await isCurrent())throw Error('This commit is no longer main.');
  for(const file of [...release.files,...release.sources]) {
    await store.upload(file);
    if(await store.verify(file)!==file.sha256)throw Error(`R2 readback failed: ${file.filename}.`);
  }
  const cleanFile=({path,...file})=>file;
  const manifest={...release,files:release.files.map(cleanFile),sources:release.sources.map(cleanFile)};
  await store.writeVersion(manifest);
  if(!await isCurrent())throw Error('Main advanced during upload; preserving the previous download.');
  await store.writeLatest(manifest,current.etag);
  return manifest;
}
