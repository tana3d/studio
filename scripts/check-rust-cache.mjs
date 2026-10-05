import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'SCCACHE_ENDPOINT', 'SCCACHE_BUCKET']) {
  if (!process.env[name]) throw Error(`Missing cache-only configuration: ${name}.`);
}
if (process.env.RUSTC_WRAPPER !== 'sccache') throw Error('Rust builds must use sccache.');
if (!/^tana-studio-sccache-(darwin-arm64|darwin-x64|linux-x64)$/.test(process.env.SCCACHE_BUCKET)) {
  throw Error('Rust compilation must use a Studio cache bucket.');
}
const client = new S3Client({
  region: 'auto', endpoint: process.env.SCCACHE_ENDPOINT,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});
await client.send(new HeadBucketCommand({ Bucket: process.env.SCCACHE_BUCKET }));
console.log(`Verified compiler cache access: ${process.env.SCCACHE_BUCKET}.`);
