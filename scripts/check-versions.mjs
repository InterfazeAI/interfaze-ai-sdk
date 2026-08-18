// Fail if package.json, jsr.json and src/version.ts disagree. npm and JSR are
// published from the same GitHub Release, and `VERSION` is a public export, so
// all three must stay in lockstep.
import { readFileSync } from 'node:fs';

const read = path =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const pkg = read('../package.json');
const jsr = read('../jsr.json');

const versionSource = readFileSync(
  new URL('../src/version.ts', import.meta.url),
  'utf8',
);
const match = versionSource.match(
  /export const VERSION\s*(?::\s*string\s*)?=\s*['"]([^'"]+)['"]/,
);

if (!match) {
  console.error('could not find a VERSION literal in src/version.ts');
  process.exit(1);
}

const sources = {
  'package.json': pkg.version,
  'jsr.json': jsr.version,
  'src/version.ts': match[1],
};

const distinct = [...new Set(Object.values(sources))];

if (distinct.length > 1) {
  console.error('version mismatch:');
  for (const [file, version] of Object.entries(sources)) {
    console.error(`  ${file}: ${version}`);
  }
  process.exit(1);
}

console.log(`versions agree: ${distinct[0]}`);
