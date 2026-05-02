import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const replaceInFile = (file, replacements) => {
  let content = fs.readFileSync(file, 'utf8');
  for (const [search, replace] of replacements) {
    content = content.replace(search, replace);
  }
  fs.writeFileSync(file, content);
}

execSync(`find src -type f -name "*.ts"`, { encoding: 'utf8' }).split('\n').filter(Boolean).forEach(file => {
  replaceInFile(file, [
    [/RpcClient\.Protocol\["Type"\]/g, 'typeof RpcClient.Protocol.Service'],
    [/\.unsafeOffer/g, '.offerUnsafe'],
    [/RpcSerialization\["Type"\]/g, 'typeof RpcSerialization.Service'],
    [/RpcSerialization\.of/g, '{'], // if it was RpcSerialization.of({ ... }), this makes it { ... } assuming it's used as a value or object where needed. Wait, `make` is better:
  ]);
});
