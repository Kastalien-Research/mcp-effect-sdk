import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

walkDir('./src/core', function(filePath) {
  if (!filePath.endsWith('.ts')) return;
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace .ts" with .js" in import and export statements
  content = content.replace(/(import.*from\s+["'][^"']+)\.ts(["'])/g, '$1.js$2');
  content = content.replace(/(export.*from\s+["'][^"']+)\.ts(["'])/g, '$1.js$2');

  // Also replace effect/internal/core with some safe equivalent or remove if not needed
  // We will patch effect/internal/core manually after reviewing the grep output

  fs.writeFileSync(filePath, content, 'utf8');
});

console.log('Fixed .ts extensions.');
