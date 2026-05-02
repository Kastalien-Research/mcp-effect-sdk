import fs from 'fs';
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
    [/typeof RpcClient\.Protocol\.Service/g, 'RpcClient.Protocol'],
    [/typeof RpcSerialization\.Service/g, 'RpcSerialization'],
    [/Effect\.async<void, never>\(\(resume\)/g, 'Effect.async((resume)'],
    [/incoming\.offerUnsafe\(decoded\)/g, 'Effect.runSync(Queue.offer(incoming, decoded))'],
    [/incoming\.offerUnsafe\(msg\)/g, 'Effect.runSync(Queue.offer(incoming, msg))'],
  ]);
});
