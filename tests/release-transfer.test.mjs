import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { releaseIdentity } from '../scripts/release-lib.mjs';
import { stage, retrieve, prefix, validateIndex } from '../scripts/release-transfer.mjs';
import { notarizationEnv } from '../scripts/notarization-env.mjs';
const identity=releaseIdentity({GITHUB_RUN_NUMBER:'55',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),GITHUB_REF:'refs/tags/v0.2.3'}),group='installer-darwin-arm64';
async function fixture(){
  const source=await mkdtemp(join(tmpdir(),'studio-stage-')),target=await mkdtemp(join(tmpdir(),'studio-fetch-')),objects=new Map(),events=[];
  await writeFile(join(source,'Studio.dmg'),'signed installer bytes');
  await writeFile(join(source,'darwin-arm64.json'),'build metadata');
  const store={
    upload:async file=>{events.push(file.name);objects.set(file.key,await readFile(file.path));},
    writeIndex:async(key,index)=>{events.push('index');objects.set(key,Buffer.from(JSON.stringify(index)));},
    readIndex:async key=>JSON.parse(objects.get(key)),
    download:async key=>Readable.from([objects.get(key)]),
  };
  return {source,target,objects,events,store,cleanup:async()=>{await rm(source,{recursive:true,force:true});await rm(target,{recursive:true,force:true});}};
}
test('R2 transfer writes the completion index last and verifies downloaded bytes',async()=>{
  const item=await fixture();try{
    const index=await stage(item.store,item.source,identity,group);
    assert.equal(item.events.at(-1),'index');assert.equal(index.files.length,2);
    await retrieve(item.store,item.target,identity,[group]);
    assert.equal(await readFile(join(item.target,group,'Studio.dmg'),'utf8'),'signed installer bytes');
    assert.ok(index.files.every(file=>!file.path&&file.key.startsWith(`staging/${identity.buildId}/`)));
  }finally{await item.cleanup();}
});
test('staging rejects mismatched runs, corrupted downloads and unsafe paths before publication',async()=>{
  const item=await fixture();try{
    const index=await stage(item.store,item.source,identity,group);
    for(const field of ['buildId','commit','version','tag'])assert.throws(()=>validateIndex({...index,identity:{...identity,[field]:'wrong'}},identity,group),/mixed/);
    for(const change of [{name:'../escape'},{key:'releases/latest.json'},{sha256:'bad'},{bytes:-1}])assert.throws(()=>validateIndex({...index,files:[{...index.files[0],...change}]},identity,group),/Invalid/);
    item.objects.set(index.files.find(file=>file.name==='Studio.dmg').key,Buffer.from('corruption'));
    await assert.rejects(retrieve(item.store,item.target,identity,[group]),/readback failed/);
    assert.ok(!(await readdir(join(item.target,group))).some(name=>name.endsWith('.partial')));
    await assert.rejects(retrieve(item.store,item.target,{...identity,buildId:'55-2-aaaaaaaaaaaa'},[group]));
    assert.throws(()=>prefix(identity,'../../releases'));
  }finally{await item.cleanup();}
});
test('a failed staging upload never writes a completion index',async()=>{
  const item=await fixture();try{
    await assert.rejects(stage({...item.store,upload:async()=>{throw Error('network interruption');}},item.source,identity,group),/network/);
    assert.ok(!item.events.includes('index'));
  }finally{await item.cleanup();}
});
test('Tauri API notarization cannot be shadowed by empty or stale Apple-ID variables',()=>{
  for(const appleId of ['', 'legacy@example.com']){
    const original={APPLE_ID:appleId,APPLE_PASSWORD:'',APPLE_TEAM_ID:'team',APPLE_API_KEY:'key-id',APPLE_API_ISSUER:'issuer',APPLE_API_KEY_PATH:'/private/key.p8',OTHER:'keep'};
    const actual=notarizationEnv(original);
    assert.ok(!('APPLE_ID' in actual));assert.ok(!('APPLE_PASSWORD' in actual));
    assert.equal(actual.APPLE_API_KEY,'key-id');assert.equal(actual.APPLE_API_KEY_PATH,'/private/key.p8');assert.equal(actual.OTHER,'keep');assert.ok('APPLE_ID' in original);
  }
  const plain=notarizationEnv({APPLE_ID:'',APPLE_PASSWORD:'',APPLE_API_KEY:'',APPLE_API_ISSUER:''});assert.deepEqual(plain,{});
});
