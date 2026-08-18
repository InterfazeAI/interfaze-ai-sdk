// Fail if package.json and jsr.json versions disagree. Both are published from
// the same GitHub Release, so they must stay in lockstep.
import { readFileSync } from 'node:fs';

const read = path =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const pkg = read('../package.json');
const jsr = read('../jsr.json');

if (pkg.version !== jsr.version) {
  console.error(
    `version mismatch: package.json ${pkg.version} !== jsr.json ${jsr.version}`,
  );
  process.exit(1);
}

console.log(`versions agree: ${pkg.version}`);
