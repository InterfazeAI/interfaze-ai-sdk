/**
 * Fail if anything under src/, examples/ or scripts/ uses a symbol the AI SDK
 * marks `@deprecated`.
 *
 * `tsc` ignores `@deprecated` — it is a JSDoc tag, not a type error — so
 * deprecated usage compiles and tests pass while the docs quietly teach an API
 * that is on its way out. This resolves every identifier through the type
 * checker (following import aliases) and reports the ones carrying the tag,
 * which is also how `@typescript-eslint/no-deprecated` works.
 *
 * `examples/` is deliberately in scope even though tsconfig.json only includes
 * `src` — the examples are the API surface readers copy from.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = ['src', 'examples', 'scripts'].flatMap(dir =>
  ts.sys.readDirectory(path.join(root, dir), ['.ts', '.mts']),
);

const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  // The examples import the package by its published name.
  baseUrl: root,
  paths: { '@interfaze-ai/ai-sdk': [path.join(root, 'src/index.ts')] },
});
const checker = program.getTypeChecker();

function deprecationOf(symbol: ts.Symbol | undefined): string | undefined {
  if (symbol == null) return undefined;
  let resolved = symbol;
  if (resolved.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = checker.getAliasedSymbol(resolved);
    } catch {
      // Unresolvable alias — nothing to report.
    }
  }
  const tag = resolved
    .getJsDocTags(checker)
    .find(({ name }) => name === 'deprecated');
  if (tag == null) return undefined;
  return ts.displayPartsToString(tag.text ?? []) || '(no replacement given)';
}

const findings: string[] = [];

for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile) continue;
  if (!files.includes(path.resolve(source.fileName))) continue;

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const message = deprecationOf(checker.getSymbolAtLocation(node));
      if (message != null) {
        const { line, character } = source.getLineAndCharacterOfPosition(
          node.getStart(),
        );
        findings.push(
          `${path.relative(root, source.fileName)}:${line + 1}:${character + 1}  ` +
            `${node.getText()} — ${message}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (findings.length > 0) {
  console.error(`deprecated API usage (${findings.length}):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`no deprecated API usage in ${files.length} files`);
