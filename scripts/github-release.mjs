import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseIdentity, verifyReleaseTag } from './release-lib.mjs';

export function releaseNotes(manifest,changes='') {
  return [
    `Studio **${manifest.version}** · [Download Studio](https://tana.gg/download)`,
    '## Downloads',
    ...manifest.files.map(file=>`- [${file.label}](${file.url})`),
    '## Checksums (SHA-256)',
    ['```text',...manifest.files.map(file=>`${file.sha256}  ${file.filename}`),'```'].join('\n'),
    '## Corresponding source',
    ...manifest.sources.map(file=>`- [${file.filename}](${file.url})`),
    changes,
  ].join('\n\n');
}

export async function publishGitHubRelease(manifest,env,request=fetch) {
  const identity=releaseIdentity(env);
  if(env.GITHUB_REPOSITORY!=='tana3d/studio'||!env.GH_TOKEN)throw Error('Release notes require the Studio release workflow token.');
  if(manifest.version!==identity.version||manifest.commit!==identity.commit||manifest.tag!==identity.tag)throw Error('Release notes must describe the published version.');
  if(!await verifyReleaseTag(identity,{...env,GITHUB_TOKEN:env.GH_TOKEN},request))throw Error('The published version tag changed before release notes were created.');
  const api=async(path,body)=>{
    const response=await request(`https://api.github.com/repos/tana3d/studio/${path}`,{
      method:body?'POST':'GET',
      headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    if(response.status===404&&!body)return null;
    if(!response.ok)throw Error(`GitHub release request failed (${response.status}).`);
    return response.json();
  };
  const existing=await api(`releases/tags/${encodeURIComponent(identity.tag)}`);
  if(existing) {
    // Preserve notes the owner may have edited; a retry never duplicates them.
    return existing;
  }
  const notes=await api('releases/generate-notes',{tag_name:identity.tag});
  // The verified existing tag selects the snapshot. Omitting target_commitish
  // avoids requesting workflow-write permission for older commits on main.
  const published=await api('releases',{
    tag_name:identity.tag,name:`Studio ${identity.version}`,
    body:releaseNotes(manifest,notes.body),draft:false,prerelease:false,make_latest:'true',
  });
  return published;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const manifest=JSON.parse(await readFile(resolve('.tmp/release/manifest.json'),'utf8'));
  const release=await publishGitHubRelease(manifest,process.env);
  console.log(`Release notes: ${release.html_url}`);
}
