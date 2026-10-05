import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseIdentity, compareVersions, verifyReleaseTag, platforms, describeFile, selectInstaller, assembleRelease, publishRelease } from '../scripts/release-lib.mjs';
import { releaseNotes, publishGitHubRelease } from '../scripts/github-release.mjs';
const environment={GITHUB_RUN_NUMBER:'23',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:'a'.repeat(40),GITHUB_REF:'refs/tags/v0.1.0',GITHUB_REPOSITORY:'tana3d/studio',GITHUB_TOKEN:'test-token'};
const identity=releaseIdentity(environment);
test('the version comes from the tag while runs and retries have independent build identities',()=>{
  assert.equal(identity.version,'0.1.0');assert.equal(identity.tag,'v0.1.0');assert.equal(identity.buildId,'23-2-aaaaaaaaaaaa');
  const retry=releaseIdentity({...environment,GITHUB_RUN_NUMBER:'24',GITHUB_RUN_ATTEMPT:'3'});
  assert.equal(retry.version,identity.version);assert.notEqual(retry.buildId,identity.buildId);
  assert.throws(()=>releaseIdentity({GITHUB_RUN_NUMBER:'../../bad'}));
  for(const ref of ['refs/heads/main','refs/tags/v01.0.0','refs/tags/v1.0.0-beta.1','refs/tags/v1.0.0+build','refs/tags/1.0.0','refs/tags/v1.2','refs/tags/v1.0.65536'])assert.throws(()=>releaseIdentity({...environment,GITHUB_REF:ref}));
});
test('installer collection ignores old cached versions and unfinished disk images',()=>{
 const valid='/bundle/dmg/Studio_0.1.0_x64.dmg';
 assert.equal(selectInstaller(['/bundle/dmg/Studio_0.0.9_x64.dmg','/bundle/dmg/rw.123.Studio_0.1.0_x64.dmg',valid],identity,'darwin-x64'),valid);
 assert.throws(()=>selectInstaller([valid,valid],identity,'darwin-x64'),/exactly one/);
});
async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),'studio-release-'));
  for(const platform of Object.keys(platforms)) {
    const file=join(directory,`Studio-${identity.version}-${platform}${platforms[platform].extension}`);await writeFile(file,'installer '+platform);
    const record=await describeFile(file,identity,platform);await writeFile(join(directory,`${platform}.json`),JSON.stringify({...identity,file:record}));
  }
  for(const name of ['blender-4.5.14.tar.xz','studio-source.tar.gz'])await writeFile(join(directory,name),'corresponding source');
  return directory;
}
test('assembly rejects missing platforms, changed payloads and mixed builds',async()=>{
  const directory=await fixture();
  try {
    const release=await assembleRelease(directory,identity);assert.equal(release.files.length,4);assert.equal(release.sources.length,2);
    await writeFile(join(directory,'Studio-0.1.0-win32-x64.exe'),'corruption');await assert.rejects(assembleRelease(directory,identity),/Corrupt/);
    await rm(join(directory,'win32-x64.json'));await assert.rejects(assembleRelease(directory,identity),/Missing/);
    await writeFile(join(directory,'win32-x64.json'),JSON.stringify({...identity,commit:'b'.repeat(40),file:{platform:'win32-x64'}}));await assert.rejects(assembleRelease(directory,identity),/Mixed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('publication never changes latest when upload, readback or tag validation fails',async()=>{
  for(const fail of ['upload','readback','main','newer']) {
    const calls=[],release={...identity,files:[{filename:'Studio.dmg',sha256:'digest',path:'/private/path'}],sources:[]};
    const store={readManifest:async()=>({etag:'etag',manifest:{version:fail==='newer'?'0.2.0':'0.0.9',buildNumber:fail==='newer'?1:99}}),upload:async()=>{calls.push('upload');if(fail==='upload')throw Error('Upload failure');},verify:async()=>fail==='readback'?'corrupt':'digest',writeVersion:async()=>calls.push('version'),writeLatest:async()=>calls.push('latest')};
    let checks=0;await assert.rejects(publishRelease(store,release,async()=>fail!=='main'||++checks<2));assert.ok(!calls.includes('latest'));
  }
});
test('successful publication writes immutable metadata first and conditionally advances latest',async()=>{
  const calls=[],release={...identity,files:[{filename:'Studio.dmg',sha256:'digest',path:'/private/path'}],sources:[]};
  const store={readManifest:async()=>({etag:'previous',manifest:{version:'0.0.9',buildNumber:99}}),upload:async()=>calls.push('upload'),verify:async()=>{calls.push('verify');return 'digest';},writeVersion:async manifest=>{assert.equal(manifest.files[0].path,undefined);calls.push('version');},writeLatest:async(_manifest,etag)=>{assert.equal(etag,'previous');calls.push('latest');}};
  await publishRelease(store,release,async()=>true);assert.deepEqual(calls,['upload','verify','version','latest']);
});
test('version order is numeric and an existing version cannot be replaced on retry',async()=>{
  assert.equal(compareVersions('0.10.0','0.9.99'),1);assert.equal(compareVersions('1.0.0','0.99.99'),1);assert.equal(compareVersions('1.2.3','1.2.3'),0);
  const published={...identity,files:[],sources:[]},retry={...published,buildId:'24-1-aaaaaaaaaaaa',buildNumber:24};
  const store={readManifest:async()=>({manifest:published})};
  assert.equal(await publishRelease(store,retry,async()=>true),published);
  await assert.rejects(publishRelease(store,{...retry,commit:'b'.repeat(40)},async()=>true),/another tag or commit/);
});
test('tag verification accepts annotated and lightweight tags after main advances',async()=>{
  for(const annotated of [true,false]) {
    const calls=[];
    const request=async url=>{
      calls.push(url);
      if(url.includes('/git/ref/'))return Response.json({object:annotated?{type:'tag',sha:'b'.repeat(40)}:{type:'commit',sha:identity.commit}});
      if(url.includes('/git/tags/'))return Response.json({object:{type:'commit',sha:identity.commit}});
      return Response.json({status:'ahead',merge_base_commit:{sha:identity.commit}});
    };
    assert.equal(await verifyReleaseTag(identity,environment,request),true);
    assert.equal(calls.length,annotated?3:2);
  }
});
test('tag verification rejects deleted or moved tags and commits outside main',async()=>{
  for(const failure of ['deleted','moved','off-main','diverged']) {
    const request=async url=>{
      if(url.includes('/git/ref/'))return failure==='deleted'?new Response(null,{status:404}):Response.json({object:{type:'commit',sha:failure==='moved'?'b'.repeat(40):identity.commit}});
      return Response.json({status:failure==='diverged'?'diverged':'ahead',merge_base_commit:{sha:failure==='off-main'?'b'.repeat(40):identity.commit}});
    };
    assert.equal(await verifyReleaseTag(identity,environment,request),false);
  }
  await assert.rejects(verifyReleaseTag(identity,environment,async()=>new Response(null,{status:503})),/Cannot verify/);
});
test('release notes communicate the exact version and immutable downloads',async()=>{
  const directory=await fixture();
  try {
    const release=await assembleRelease(directory,identity),notes=releaseNotes(release,'## Changes\n\nNew character controls.');
    assert.ok(notes.includes('Studio **0.1.0**'));assert.ok(notes.includes('Studio-0.1.0-darwin-arm64.dmg'));
    assert.ok(notes.includes(release.files[0].url));assert.ok(notes.includes(release.files[0].sha256));assert.ok(notes.includes('New character controls.'));
    assert.ok(!notes.includes(directory));
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('GitHub release creation uses the published tag and generates user-facing notes',async()=>{
  const calls=[],manifest={...identity,files:[],sources:[]};
  const request=async(url,options)=>{
    if(url.includes('/git/ref/'))return Response.json({object:{type:'commit',sha:identity.commit}});
    if(url.includes('/compare/'))return Response.json({status:'ahead',merge_base_commit:{sha:identity.commit}});
    calls.push({url,...options});
    if(calls.length===1)return new Response(null,{status:404});
    if(calls.length===2)return Response.json({body:'## Changes\n\nSmooth character controls.'});
    return Response.json({html_url:'https://github.com/tana3d/studio/releases/tag/v0.1.0'});
  };
  const result=await publishGitHubRelease(manifest,{...environment,GH_TOKEN:'test-token'},request);
  assert.ok(result.html_url.endsWith('/v0.1.0'));assert.equal(calls.length,3);
  assert.equal(calls[0].method,'GET');assert.ok(calls[1].url.endsWith('/releases/generate-notes'));
  const body=JSON.parse(calls[2].body);
  assert.equal(body.tag_name,identity.tag);assert.equal(body.target_commitish,undefined);
  assert.equal(body.name,'Studio 0.1.0');assert.equal(body.draft,false);assert.equal(body.make_latest,'true');assert.ok(body.body.includes('Smooth character controls.'));
});
test('GitHub release retries preserve owner-edited notes and reject mixed identities',async()=>{
  const manifest={...identity,files:[],sources:[]},existing={html_url:'https://github.com/tana3d/studio/releases/tag/v0.1.0',body:'Custom release announcement'};
  let calls=0;
  const request=async url=>{
    if(url.includes('/git/ref/'))return Response.json({object:{type:'commit',sha:identity.commit}});
    if(url.includes('/compare/'))return Response.json({status:'identical',merge_base_commit:{sha:identity.commit}});
    calls++;return Response.json(existing);
  };
  assert.deepEqual(await publishGitHubRelease(manifest,{...environment,GH_TOKEN:'test-token'},request),existing);
  assert.equal(calls,1);
  await assert.rejects(publishGitHubRelease({...manifest,commit:'b'.repeat(40)},{...environment,GH_TOKEN:'test-token'},request),/published version/);
  assert.equal(calls,1);
});
