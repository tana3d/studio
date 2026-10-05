import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { releaseIdentity, platforms, walk, describeFile, selectInstaller, assembleRelease, publishRelease } from './release-lib.mjs';

const root=resolve(import.meta.dirname,'..'),command=process.argv[2];
const config=JSON.parse(await readFile(join(root,'src-tauri/tauri.conf.json'),'utf8'));
const identity=releaseIdentity({...process.env,STUDIO_BASE_VERSION:config.version});
const output=join(root,'.tmp/release');await mkdir(output,{recursive:true});
if(command==='configure') {
  const platform=process.env.RELEASE_PLATFORM,spec=platforms[platform];
  if(!spec)throw Error('Unsupported release platform.');
  const signing=platform.startsWith('darwin')?{macOS:{signingIdentity:process.env.RELEASE_PUBLISH==='true'?config.bundle.macOS.signingIdentity:'-'}}:{};
  const targets=platform.startsWith('darwin')?['app','dmg']:[platform.startsWith('win32')?'nsis':'appimage'];
  await writeFile(join(root,'.tmp/release-config.json'),JSON.stringify({version:identity.version,bundle:{...signing,targets}}));
} else if(command==='collect') {
  const platform=process.env.RELEASE_PLATFORM,spec=platforms[platform];
  if(!spec)throw Error('Unsupported release platform.');
  const directory=platform.startsWith('darwin')?'dmg':platform.startsWith('win32')?'nsis':'appimage';
  const installer=selectInstaller(await walk(join(root,'.target/release/bundle',directory)),identity,platform);
  const file=await describeFile(installer,identity,platform);
  await copyFile(installer,join(output,file.filename));
  await writeFile(join(output,`${platform}.json`),JSON.stringify({...identity,file},null,2));
  console.log(`Prepared ${platform}: ${file.bytes} bytes, SHA-256 ${file.sha256}`);
} else if(command==='publish'||command==='assemble') {
  const release=await assembleRelease(resolve(process.argv[3]??'.tmp/artifacts'),identity);
  if(command==='assemble') {
    await writeFile(join(output,'manifest.json'),JSON.stringify(release,(_key,value)=>_key==='path'?undefined:value,2));
    console.log(`Verified ${release.files.length} installers and ${release.sources.length} source archives.`);
  } else {
    const {S3Client,GetObjectCommand,PutObjectCommand}=await import('@aws-sdk/client-s3');
    const {Upload}=await import('@aws-sdk/lib-storage');
    for(const key of ['R2_ACCOUNT_ID','R2_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','GITHUB_TOKEN'])if(!process.env[key])throw Error(`Missing ${key}.`);
    const s3=new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'}),Bucket=process.env.R2_BUCKET;
    const store={
      async readManifest(){
        try{const object=await s3.send(new GetObjectCommand({Bucket,Key:'latest.json'}));return {manifest:JSON.parse(await object.Body.transformToString()),etag:object.ETag};}
        catch(error){if(error.$metadata?.httpStatusCode===404)return {};throw error;}
      },
      async upload(file){await new Upload({client:s3,params:{Bucket,Key:file.key,Body:createReadStream(file.path),ContentLength:file.bytes,ContentType:'application/octet-stream',ContentDisposition:`attachment; filename="${file.filename}"`,CacheControl:'public, max-age=31536000, immutable',Metadata:{sha256:file.sha256,commit:identity.commit}},partSize:16*1024*1024,queueSize:2,leavePartsOnError:false}).done();},
      async verify(file){const object=await s3.send(new GetObjectCommand({Bucket,Key:file.key}));if(object.ContentLength!==file.bytes)throw Error('R2 object size mismatch.');const hash=createHash('sha256');for await(const chunk of object.Body)hash.update(chunk);return hash.digest('hex');},
      async writeVersion(manifest){await s3.send(new PutObjectCommand({Bucket,Key:`releases/${identity.buildId}/manifest.json`,Body:JSON.stringify(manifest),ContentType:'application/json',CacheControl:'public, max-age=31536000, immutable'}));},
      async writeLatest(manifest,etag){await s3.send(new PutObjectCommand({Bucket,Key:'latest.json',Body:JSON.stringify(manifest),ContentType:'application/json',CacheControl:'no-cache',...(etag?{IfMatch:etag}:{IfNoneMatch:'*'})}));},
    };
    const isCurrent=async()=>{const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/git/ref/heads/main`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'}});if(!response.ok)throw Error('Cannot verify the main commit.');return (await response.json()).object.sha===identity.commit;};
    await publishRelease(store,release,isCurrent);
    console.log(`Published Studio ${identity.version}: https://tana.gg/download`);
  }
} else throw Error('Use configure, collect, assemble or publish.');
