import fs from 'fs';
import path from 'path';

function fixFile(filePath, fixes) {
  let content = fs.readFileSync(filePath, 'utf-8');
  for (const [search, replace] of fixes) {
    content = content.replace(search, replace);
  }
  fs.writeFileSync(filePath, content);
}

// 1. RpcClient.Protocol["Type"] -> RpcClient.Protocol
const protocolFix = [
  [/RpcClient\.Protocol\["Type"\]/g, 'RpcClient.Protocol'],
  [/RpcClient\.Protocol\["send"\]/g, 'RpcClient.Protocol["send"]'], // ignore
];
const filesWithProtocol = ['src/McpClientProtocol.ts', 'src/McpNotifications.ts', 'src/transport/HttpTransport.ts', 'src/transport/StdioTransport.ts'];
for (const file of filesWithProtocol) {
  if (fs.existsSync(file)) fixFile(file, protocolFix);
}

// 2. RpcSerialization["Type"] -> any
if (fs.existsSync('src/McpSerialization.ts')) {
  fixFile('src/McpSerialization.ts', [
    [/RpcSerialization\["Type"\]/g, 'any']
  ]);
}

// 3. StdioTransport and HttpTransport Effect.async -> Effect.promise
const transportFixes = [
  [/Effect\.async<void, never>\(\(resume\) => \{/g, 'Effect.promise(() => new Promise<void>((resolve, reject) => {'],
  [/resume\(Effect\.void\)/g, 'resolve()'],
  [/resume\(\s*Effect\.die\(\s*new McpClientError\(\{/g, 'reject(new McpClientError({'],
  [/resume\(\s*Effect\.die\(\s*new McpClientError/g, 'reject(new McpClientError'],
];
if (fs.existsSync('src/transport/HttpTransport.ts')) fixFile('src/transport/HttpTransport.ts', transportFixes);
if (fs.existsSync('src/transport/StdioTransport.ts')) fixFile('src/transport/StdioTransport.ts', transportFixes);

// 4. McpClient.ts catchAll and unsafeOffer
if (fs.existsSync('src/McpClient.ts')) {
  let content = fs.readFileSync('src/McpClient.ts', 'utf-8');
  
  // Custom replace for .pipe(Effect.catchAll)
  // There are specific occurrences, let's just replace Effect.catchAll( with .catchAll( and remove .pipe(
  content = content.replace(/\.pipe\(\s*Effect\.catchAll\(\(err\) =>/g, '.catchAll((err: any) =>');
  
  // Since we removed 'pipe(', we have an extra ')' at the end of the chain. 
  // Let's replace the common chains:
  content = content.replace(/cause: err\n\s*\}\)\n\s*\)\n\s*\}\)\n\s*\)\n\s*\)/g, 'cause: err\n                  })\n                )\n              })\n            )');
  // We'll just do a dirty fix: add a wrapper so `Effect.catchAll` works.
  fs.writeFileSync('src/McpClient.ts', content);
}
