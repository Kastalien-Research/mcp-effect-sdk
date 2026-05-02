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
    [/\.pipe\(\s*Effect\.catchAll\(\(err\)\s*=>/g, '.catchAll((err: any) =>'],
    [/\.pipe\(\n\s*Effect\.catchAll\(\(err\)\s*=>/g, '.catchAll((err: any) =>'],
  ]);
});
