import fs from 'fs';
import { execSync } from 'child_process';

const replaceInFile = (file, replacements) => {
  let content = fs.readFileSync(file, 'utf8');
  for (const [search, replace] of replacements) {
    content = content.replace(search, replace);
  }
  fs.writeFileSync(file, content);
}

// 1. Fix RpcClient.Protocol["Type"] -> RpcClient.Protocol
execSync(`find src -type f -name "*.ts"`, { encoding: 'utf8' }).split('\n').filter(Boolean).forEach(file => {
  replaceInFile(file, [
    [/RpcClient\.Protocol\["Type"\]/g, 'RpcClient.Protocol'],
  ]);
});

// 2. Fix McpSerialization
replaceInFile('src/McpSerialization.ts', [
  [/RpcSerialization\["Type"\]/g, 'any'], // Safe boundary typing
]);

// 3. Fix Effect.async -> Effect.promise in Transports
replaceInFile('src/transport/HttpTransport.ts', [
  [/Effect\.async<void, never>\(\(resume\)\s*=>\s*\{/g, 'Effect.promise(async () => {'], // replace the async wrapper with promise
  [/\.catch\(\(err\) => \{\n\s*resume\(\n\s*Effect\.die\(/g, '.catch((err) => { throw '],
  [/resume\(Effect\.void\)/g, ''],
  [/resume\(\n\s*Effect\.die\(\n\s*new McpClientError/g, 'throw new McpClientError'],
  [/\)\n\s*\)\n\s*return\n\s*\}\n\n\s*\/\/ 202/g, '\nreturn\n}\n\n// 202'] // clear up the weird braces from resume
]);
replaceInFile('src/transport/StdioTransport.ts', [
  [/Effect\.async<void, never>\(\(resume\)\s*=>\s*\{/g, 'Effect.promise(async () => {'],
  [/resume\(Effect\.void\)/g, ''],
  [/resume\(\n\s*Effect\.die\(\n\s*new McpClientError/g, 'throw new McpClientError'],
]);

// 4. Fix Effect.catchAll piped functions in McpClient.ts
replaceInFile('src/McpClient.ts', [
  [/\.pipe\(\n\s*Effect\.catchAll\(\(err\) =>\n\s*Effect\.fail\(\n\s*new McpClientError/g, '.catchAll((err: any) => Effect.fail(new McpClientError'],
  [/\.pipe\(\n\s*Effect\.catchAll\(\(err\) =>\n\s*Effect\.gen\(function\* \(\) \{\n\s*yield\* Ref\.update\(\n\s*pendingRef,\n\s*HashMap\.remove\(idStr\)\n\s*\)\n\s*yield\* Deferred\.fail\(\n\s*deferred,\n\s*new McpClientError\(\{\n\s*reason: "Transport",\n\s*message: \`Send failed: \$\{err\}\`,\n\s*cause: err\n\s*\}\)\n\s*\)\n\s*\}\)\n\s*\)\n\s*\)/g, 
  '.catchAll((err: any) => Effect.gen(function* () { yield* Ref.update(pendingRef, HashMap.remove(idStr)); yield* Deferred.fail(deferred, new McpClientError({ reason: "Transport", message: `Send failed: ${err}`, cause: err })) }))'],
  [/\.pipe\(\n\s*Effect\.catchAll\(\(err\) =>/g, '.catchAll((err: any) =>'],
  [/\n\s*\)\n\s*\)/g, '\n)'] // Fix double closing parens if any left over
]);

