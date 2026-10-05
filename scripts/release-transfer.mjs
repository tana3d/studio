// Intermediate build files travel through R2, independently of GitHub artifact quotas.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, walk, releaseIdentity } from './release-lib.mjs';

export const groups=['installer-darwin-arm64','installer-darwin-x64','installer-linux-x64','corresponding-source'];
const safeName=name=>typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)&&name!=='.'&&name!=='..';
export function prefix(identity,group) {
  if(!groups.includes(group)||!/^\d+-\d+-[a-f0-9]{12}$/.test(identity.buildId))throw Error('Invalid release staging group.');
  return `staging/${identity.buildId}/${group}`;
}
export function validateIndex(index,identity,group) {
  if(index?.schema!==1||index.group!==group||['buildId','commit','version','tag'].some(key=>index.identity?.[key]!==identity[key])||!Array.isArray(index.files)||!index.files.length||index.files.length>32)throw Error('Missing or mixed release staging files.');
  const names=new Set();
  for(const file of index.files) {
    if(!safeName(file.name)||names.has(file.name)||file.name==='index.json'||file.key!==`${prefix(identity,group)}/${file.name}`||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<1)throw Error('Invalid release staging file.');
    names.add(file.name);
  }
  return index;
}
export async function stage(store,directory,identity,group) {
  const files=[];
  for(const path of await walk(directory)) {
    const name=basename(path);
    if(!safeName(name)||name==='index.json'||files.some(file=>file.name===name))throw Error('Unsafe or duplicate staging filename.');
    files.push({name,key:`${prefix(identity,group)}/${name}`,bytes:(await stat(path)).size,sha256:await digest(path),path});
  }
  const index={schema:1,group,identity,files:files.map(({path,...file})=>file)};
  validateIndex(index,identity,group);
  for(const file of files)await store.upload(file);
  // Write the index last: an interrupted upload cannot look like a complete group.
  await store.writeIndex(`${prefix(identity,group)}/index.json`,index);
  return index;
}
export async function retrieve(store,directory,identity,selected=groups) {
  for(const group of selected) {
    const index=validateIndex(await store.readIndex(`${prefix(identity,group)}/index.json`),identity,group);
    const target=join(directory,group);await mkdir(target,{recursive:true});
    for(const file of index.files) {
      const path=join(target,file.name),partial=`${path}.partial`,hash=createHash('sha256');let bytes=0;
      const verifier=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;hash.update(chunk);done(null,chunk);}});
      try {
        await pipeline(await store.download(file.key),verifier,createWriteStream(partial,{mode:0o600}));
        if(bytes!==file.bytes||hash.digest('hex')!==file.sha256)throw Error(`R2 staging readback failed: ${file.name}.`);
        await rename(partial,path);
      } catch(error){await rm(partial,{force:true});throw error;}
    }
  }
}
export async function createStore(env=process.env) {
  for(const name of ['R2_ACCOUNT_ID','R2_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'])if(!env[name])throw Error(`Missing ${name}.`);
  const {S3Client,GetObjectCommand,PutObjectCommand}=await import('@aws-sdk/client-s3');
  const {Upload}=await import('@aws-sdk/lib-storage');
  const client=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.AWS_ACCESS_KEY_ID,secretAccessKey:env.AWS_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'}),Bucket=env.R2_BUCKET;
  return {
    async upload(file){await new Upload({client,params:{Bucket,Key:file.key,Body:createReadStream(file.path),ContentLength:file.bytes,ContentType:'application/octet-stream',CacheControl:'no-store',Metadata:{sha256:file.sha256}},partSize:16*1024*1024,queueSize:2,leavePartsOnError:false}).done();},
    async writeIndex(key,index){await client.send(new PutObjectCommand({Bucket,Key:key,Body:JSON.stringify(index),ContentType:'application/json',CacheControl:'no-store'}));},
    async readIndex(key){const response=await client.send(new GetObjectCommand({Bucket,Key:key}));if(response.ContentLength>64*1024)throw Error('Oversized staging index.');return JSON.parse(await response.Body.transformToString());},
    async download(key){const response=await client.send(new GetObjectCommand({Bucket,Key:key}));return response.Body instanceof Readable?response.Body:Readable.fromWeb(response.Body);},
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const identity=releaseIdentity(process.env),store=await createStore(),command=process.argv[2];
  if(command==='upload') {
    const index=await stage(store,resolve(process.argv[4]),identity,process.argv[3]);
    console.log(`Staged ${index.group}: ${index.files.length} files in R2.`);
  } else if(command==='download') {
    await retrieve(store,resolve(process.argv[3]),identity);
    console.log('Retrieved and verified all release groups from R2.');
  } else throw Error('Use upload <group> <directory> or download <directory>.');
}
