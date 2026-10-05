// Use a job-local signing keychain without replacing a shared host’s keychains.
import { spawnSync } from 'node:child_process';
import { randomBytes, createPrivateKey } from 'node:crypto';
import { writeFileSync, unlinkSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const directory=process.env.RUNNER_TEMP;
if(!directory||process.platform!=='darwin')throw Error('Apple CI signing requires a macOS runner.');
const keychain=join(directory,'studio-signing.keychain-db');
const apiKeyFile=join(directory,'studio-notarization.p8');
const run=(args,required=true)=>{const result=spawnSync('security',args,{stdio:'pipe'});if(required&&(result.error||result.status!==0))throw Error(`Apple keychain ${args[0]} failed. Check the signing credentials.`);return result.stdout?.toString()??'';};
const searchList=()=>Array.from(run(['list-keychains','-d','user']).matchAll(/"([^"]+)"/g),match=>match[1]);
const removeOwnKeychain=()=>{const existing=searchList();if(existing.includes(keychain))run(['list-keychains','-d','user','-s',...existing.filter(path=>path!==keychain)]);run(['delete-keychain',keychain],false);};
if(process.argv[2]==='cleanup'){try{removeOwnKeychain();}finally{rmSync(apiKeyFile,{force:true});}}
else {
  for(const name of ['APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD'])if(!process.env[name])throw Error(`Add the ${name} secret to the release environment before publishing macOS installers.`);
  if(process.env.APPLE_API_KEY||process.env.APPLE_API_ISSUER||process.env.APPLE_API_PRIVATE_KEY) {
    if(!/^[A-Z0-9]{10}$/.test(process.env.APPLE_API_KEY??'')||!/^[a-f0-9-]{36}$/i.test(process.env.APPLE_API_ISSUER??'')||!process.env.APPLE_API_PRIVATE_KEY||!process.env.GITHUB_ENV)throw Error('Configure all three Apple notarization API secrets.');
    const privateKey=createPrivateKey(process.env.APPLE_API_PRIVATE_KEY);
    if(privateKey.asymmetricKeyType!=='ec'||privateKey.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error('Invalid Apple notarization private key.');
    writeFileSync(apiKeyFile,process.env.APPLE_API_PRIVATE_KEY,{mode:0o600});
    appendFileSync(process.env.GITHUB_ENV,`APPLE_API_KEY_PATH=${apiKeyFile}\nAPPLE_KEYCHAIN_PATH=${keychain}\n`);
  } else if(!process.env.APPLE_ID||!process.env.APPLE_PASSWORD)throw Error('Configure Apple API notarization credentials before publishing macOS installers.');
  const file=join(directory,'studio-signing.p12'),password=randomBytes(32).toString('hex');
  writeFileSync(file,Buffer.from(process.env.APPLE_CERTIFICATE,'base64'),{mode:0o600});
  try {
    run(['create-keychain','-p',password,keychain]);run(['set-keychain-settings','-lut','7200',keychain]);run(['unlock-keychain','-p',password,keychain]);
    run(['import',file,'-k',keychain,'-P',process.env.APPLE_CERTIFICATE_PASSWORD,'-T','/usr/bin/codesign']);
    run(['set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',password,keychain]);
    run(['list-keychains','-d','user','-s',...new Set([...searchList(),keychain])]);
  } finally {unlinkSync(file);}
}
