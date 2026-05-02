import fs from 'fs';
const lines = fs.readFileSync('src/McpSerialization.ts', 'utf-8').split('\n');
lines[216] = '  }';
lines[260] = '  }';
fs.writeFileSync('src/McpSerialization.ts', lines.join('\n'));
