import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? 
      walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('./src/core', function(filePath) {
  if (!filePath.endsWith('.ts')) return;
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace up to 4 levels of ../ indicating root effect package
  content = content.replace(/from "\.\.\/\.\.\/\.\.\/\.\.\/([^"]+)\.ts"/g, 'from "effect/$1"');
  content = content.replace(/from "\.\.\/\.\.\/\.\.\/([^"]+)\.ts"/g, 'from "effect/$1"');
  content = content.replace(/from "\.\.\/\.\.\/([^"]+)\.ts"/g, 'from "effect/$1"');

  fs.writeFileSync(filePath, content, 'utf8');
});

console.log('Imports rewritten successfully.');
