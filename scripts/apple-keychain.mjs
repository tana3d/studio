// Import only into an ephemeral GitHub-hosted runner keychain; never log keys.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const directory=process.env.RUNNER_TEMP;
if(!directory||process.platform!=='darwin')throw Error('Apple CI signing requires a macOS runner.');
const keychain=join(directory,'studio-signing.keychain-db');
const run=(args,required=true)=>{const result=spawnSync('security',args,{stdio:'pipe'});if(required&&(result.error||result.status!==0))throw Error(`Apple keychain ${args[0]} failed. Check the signing credentials.`);};
if(process.argv[2]==='cleanup'){run(['delete-keychain',keychain],false);}
else {
  for(const name of ['APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD','APPLE_ID','APPLE_PASSWORD'])if(!process.env[name])throw Error(`Add the ${name} secret to the release environment before publishing macOS installers.`);
  const file=join(directory,'studio-signing.p12'),password=randomBytes(32).toString('hex');
  writeFileSync(file,Buffer.from(process.env.APPLE_CERTIFICATE,'base64'),{mode:0o600});
  try {
    run(['create-keychain','-p',password,keychain]);run(['set-keychain-settings','-lut','7200',keychain]);run(['unlock-keychain','-p',password,keychain]);
    run(['import',file,'-k',keychain,'-P',process.env.APPLE_CERTIFICATE_PASSWORD,'-T','/usr/bin/codesign']);
    run(['set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',password,keychain]);
    run(['list-keychains','-d','user','-s',keychain]);
  } finally {unlinkSync(file);}
}
