import fs from 'fs';
import path from 'path';

function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    let p = path.join(dir, f);
    if(fs.statSync(p).isDirectory()) walk(p);
    else if(p.endsWith('.ts')) {
      let c = fs.readFileSync(p, 'utf8');
      c = c.replace(/from\s+["']([^"']+)\.ts["']/g, 'from "$1.js"');
      fs.writeFileSync(p, c);
    }
  });
}
walk('./src/core');
console.log("Done");
