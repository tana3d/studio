import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

export const platforms = {
  'darwin-arm64': {label:'macOS Apple Silicon',extension:'.dmg',target:'darwin-aarch64'},
  'darwin-x64': {label:'macOS Intel',extension:'.dmg',target:'darwin-x86_64'},
  'linux-x64': {label:'Linux',extension:'.AppImage',target:'linux-x86_64'},
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
  const tag=env.GITHUB_REF?.replace(/^refs\/tags\//,'');
  if(!env.GITHUB_REF?.startsWith('refs/tags/')||!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag??''))throw Error('Release from a stable version tag such as v0.1.0.');
  const version=tag.slice(1);
  if(version.split('.').some(part=>!Number.isSafeInteger(Number(part))||Number(part)>65535))throw Error('Version components must fit Windows installer fields (0–65535).');
  return {schema:1,tag,version,buildNumber:number,buildId:`${number}-${attempt}-${env.GITHUB_SHA.slice(0,12)}`,commit:env.GITHUB_SHA};
}
export function compareVersions(left,right) {
  const parts=value=>{
    if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value??''))throw Error('Invalid published version.');
    const parsed=value.split('.').map(Number);
    if(parsed.some(part=>!Number.isSafeInteger(part)))throw Error('Invalid published version.');
    return parsed;
  };
  const a=parts(left),b=parts(right);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;
  return 0;
}
// Resolve both lightweight and annotated tags, then confirm main still contains
// the released commit. New work on main does not invalidate a version tag.
export async function verifyReleaseTag(identity,env,request=fetch) {
  if(env.GITHUB_REPOSITORY!=='tana3d/studio')throw Error('Release repository must be tana3d/studio.');
  const api=async path=>{
    const response=await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,{headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'}});
    if(response.status===404)return null;
    if(!response.ok)throw Error('Cannot verify the release tag.');
    return response.json();
  };
  const ref=await api(`git/ref/tags/${encodeURIComponent(identity.tag)}`);
  let object=ref?.object;
  for(let depth=0;object?.type==='tag'&&depth<10;depth++)object=(await api(`git/tags/${object.sha}`))?.object;
  if(object?.type!=='commit'||object.sha!==identity.commit)return false;
  const comparison=await api(`compare/${identity.commit}...main`);
  return comparison?.merge_base_commit?.sha===identity.commit&&['ahead','identical'].includes(comparison.status);
}
export async function describeFile(file,identity,platform=null,extension=platforms[platform]?.extension) {
  const name=platform?`Studio-${identity.version}-${platform}${extension}`:basename(file);
  if(!/^[\w.-]+$/.test(name))throw Error('Unsafe release filename.');
  const bytes=(await stat(file)).size;
  if(!bytes)throw Error('Empty release artifact.');
  const key=`releases/${identity.buildId}/${name}`;
  return {platform,label:platform?platforms[platform].label:name,key,url:`https://tana.gg/downloads/${key}`,bytes,sha256:await digest(file),filename:name};
}
// Verify the same prehashed Minisign format and signed version used by Tauri.
// This catches corrupt/mixed build outputs before making the release public.
export async function verifyUpdate(file,signature,pubkey,version) {
  const decode=value=>{
    if(typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length%4!==0)throw Error('Invalid update signature encoding.');
    return Buffer.from(value,'base64');
  };
  const keyLines=decode(pubkey).toString('utf8').trim().split(/\r?\n/);
  const key=decode(keyLines[1]);
  const lines=decode(signature).toString('utf8').trim().split(/\r?\n/);
  if(key.length!==42||key.subarray(0,2).toString()!=='Ed'||lines.length!==4||!lines[2].startsWith('trusted comment: '))throw Error('Invalid signed update.');
  const signed=decode(lines[1]),global=decode(lines[3]),comment=lines[2].slice('trusted comment: '.length);
  if(signed.length!==74||signed.subarray(0,2).toString()!=='ED'||!signed.subarray(2,10).equals(key.subarray(2,10))||global.length!==64||comment.split('\t').filter(part=>part.startsWith('version:')).join('')!==`version:${version}`)throw Error('Update key or signed version mismatch.');
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.subarray(10)]),format:'der',type:'spki'});
  if(!verify(null,Buffer.concat([signed.subarray(10),Buffer.from(comment)]),publicKey,global))throw Error('Invalid update comment signature.');
  const hash=createHash('blake2b512');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  if(!verify(null,hash.digest(),publicKey,signed.subarray(10)))throw Error('Invalid update payload signature.');
}
export async function describeUpdate(file,signature,identity,platform,pubkey) {
  await verifyUpdate(file,signature,pubkey,identity.version);
  return {...await describeFile(file,identity,platform,platform.startsWith('darwin')?'.app.tar.gz':platforms[platform].extension),target:platforms[platform].target,signature};
}
export function selectInstaller(paths,identity,platform) {
  const matches=paths.filter(path=>basename(path).toLowerCase().startsWith(`Studio_${identity.version}_`.toLowerCase())&&path.toLowerCase().endsWith(platforms[platform].extension.toLowerCase()));
  if(matches.length!==1)throw Error(`Expected exactly one ${platform} installer for ${identity.version}, found ${matches.length}.`);
  return matches[0];
}
export async function assembleRelease(directory,identity,pubkey) {
  const paths=await walk(directory),files=[],sources=[],updates=[];
  for(const [platform,spec]of Object.entries(platforms)) {
    const metadata=paths.filter(path=>basename(path)===`${platform}.json`);
    if(metadata.length!==1)throw Error(`Missing or duplicate ${platform} release metadata.`);
    const {readFile}=await import('node:fs/promises');
    const record=JSON.parse(await readFile(metadata[0],'utf8'));
    if(record.buildId!==identity.buildId||record.commit!==identity.commit||record.version!==identity.version||record.tag!==identity.tag||record.file.platform!==platform)throw Error('Mixed release builds are not allowed.');
    const payload=paths.filter(path=>basename(path)===record.file.filename);
    if(payload.length!==1)throw Error(`Missing or duplicate ${platform} installer.`);
    const actual=await describeFile(payload[0],identity,platform);
    if(actual.sha256!==record.file.sha256||actual.bytes!==record.file.bytes)throw Error(`Corrupt ${platform} artifact.`);
    files.push({...actual,path:payload[0]});
    if(!record.update||record.update.platform!==platform||record.update.target!==spec.target)throw Error(`Missing signed ${platform} update.`);
    const updatePayload=paths.filter(path=>basename(path)===record.update.filename);
    if(updatePayload.length!==1)throw Error(`Missing or duplicate ${platform} update payload.`);
    const update=await describeUpdate(updatePayload[0],record.update.signature,identity,platform,pubkey);
    if(['key','url','filename','bytes','sha256'].some(key=>update[key]!==record.update[key]))throw Error(`Corrupt ${platform} update metadata.`);
    if(!platform.startsWith('darwin')&&update.sha256!==actual.sha256)throw Error('Update must match its installer.');
    updates.push({...update,path:updatePayload[0]});
  }
  for(const name of ['blender-4.5.14.tar.xz','studio-source.tar.gz']) {
    const matches=paths.filter(path=>basename(path)===name);
    if(matches.length!==1)throw Error(`Missing corresponding source: ${name}.`);
    sources.push({...await describeFile(matches[0],identity),path:matches[0]});
  }
  return {...identity,publishedAt:new Date().toISOString(),files,sources,updates};
}
// Only advance the public pointer after every payload is read back and checked.
// The conditional pointer write also protects against concurrent publishers.
export async function publishRelease(store,release,isCurrent) {
  const current=await store.readManifest();
  if(!await isCurrent())throw Error('The release tag changed or its commit is not on main.');
  if(current.manifest) {
    const order=compareVersions(current.manifest.version,release.version);
    if(order>0)throw Error('A newer version is already published.');
    if(order===0) {
      if(current.manifest.commit!==release.commit||current.manifest.tag!==release.tag)throw Error('This version is already published from another tag or commit.');
      // A retry can repair release notes without replacing signed installers.
      return current.manifest;
    }
  }
  const payloads=new Map([...release.files,...release.sources,...(release.updates??[])].map(file=>[file.key??file.filename,file]));
  for(const file of payloads.values()) {
    await store.upload(file);
    if(await store.verify(file)!==file.sha256)throw Error(`R2 readback failed: ${file.filename}.`);
  }
  const cleanFile=({path,...file})=>file;
  const manifest={...release,files:release.files.map(cleanFile),sources:release.sources.map(cleanFile)};
  if(release.updates)manifest.updates=release.updates.map(cleanFile);
  await store.writeVersion(manifest);
  if(!await isCurrent())throw Error('The release tag changed during upload; preserving the previous download.');
  await store.writeLatest(manifest,current.etag);
  return manifest;
}
