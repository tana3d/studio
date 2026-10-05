import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseIdentity, platforms, describeFile, assembleRelease, publishRelease } from '../scripts/release-lib.mjs';
const identity=releaseIdentity({GITHUB_RUN_NUMBER:'23',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:'a'.repeat(40),STUDIO_BASE_VERSION:'0.1.0'});
test('each run and retry has an independent versioned release identity',()=>{
  assert.equal(identity.version,'0.1.23');assert.equal(identity.buildId,'23-2-aaaaaaaaaaaa');
  assert.throws(()=>releaseIdentity({GITHUB_RUN_NUMBER:'../../bad'}));
});
async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),'studio-release-'));
  for(const platform of Object.keys(platforms)) {
    const file=join(directory,`Studio-${platform}${platforms[platform].extension}`);await writeFile(file,'installer '+platform);
    const record=await describeFile(file,identity,platform);await writeFile(join(directory,`${platform}.json`),JSON.stringify({...identity,file:record}));
  }
  for(const name of ['blender-4.5.14.tar.xz','studio-source.tar.gz'])await writeFile(join(directory,name),'corresponding source');
  return directory;
}
test('assembly rejects missing platforms, changed payloads and mixed builds',async()=>{
  const directory=await fixture();
  try {
    const release=await assembleRelease(directory,identity);assert.equal(release.files.length,4);assert.equal(release.sources.length,2);
    await writeFile(join(directory,'Studio-win32-x64.exe'),'corruption');await assert.rejects(assembleRelease(directory,identity),/Corrupt/);
    await rm(join(directory,'win32-x64.json'));await assert.rejects(assembleRelease(directory,identity),/Missing/);
    await writeFile(join(directory,'win32-x64.json'),JSON.stringify({...identity,commit:'b'.repeat(40),file:{platform:'win32-x64'}}));await assert.rejects(assembleRelease(directory,identity),/Mixed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('publication never changes latest when upload, readback or main validation fails',async()=>{
  for(const fail of ['upload','readback','main','newer']) {
    const calls=[],release={...identity,files:[{filename:'Studio.dmg',sha256:'digest',path:'/private/path'}],sources:[]};
    const store={readManifest:async()=>({etag:'etag',manifest:{buildNumber:fail==='newer'?24:22}}),upload:async()=>{calls.push('upload');if(fail==='upload')throw Error('Upload failure');},verify:async()=>fail==='readback'?'corrupt':'digest',writeVersion:async()=>calls.push('version'),writeLatest:async()=>calls.push('latest')};
    let checks=0;await assert.rejects(publishRelease(store,release,async()=>fail!=='main'||++checks<2));assert.ok(!calls.includes('latest'));
  }
});
test('successful publication writes immutable metadata first and conditionally advances latest',async()=>{
  const calls=[],release={...identity,files:[{filename:'Studio.dmg',sha256:'digest',path:'/private/path'}],sources:[]};
  const store={readManifest:async()=>({etag:'previous',manifest:{buildNumber:22}}),upload:async()=>calls.push('upload'),verify:async()=>{calls.push('verify');return 'digest';},writeVersion:async manifest=>{assert.equal(manifest.files[0].path,undefined);calls.push('version');},writeLatest:async(_manifest,etag)=>{assert.equal(etag,'previous');calls.push('latest');}};
  await publishRelease(store,release,async()=>true);assert.deepEqual(calls,['upload','verify','version','latest']);
});
