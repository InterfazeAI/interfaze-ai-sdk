/**
 * Fail if this repo uses an API the AI SDK marks `@deprecated`.
 *
 * `tsc` ignores `@deprecated` — it is a JSDoc tag, not a type error — so
 * deprecated usage compiles and tests pass while the docs quietly teach an API
 * on its way out. Identifiers are resolved through the type checker, following
 * import aliases and object-destructuring patterns, which is how
 * `@typescript-eslint/no-deprecated` works.
 *
 * Covers `src/`, `examples/`, `scripts/` and the `ts` snippets in README.md.
 * Only declarations inside `ai` and `@ai-sdk/*` count: every dependency's
 * deprecations would otherwise red-line CI on an unrelated `@types/node` bump.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** TypeScript reports forward slashes everywhere; Windows `path` APIs do not. */
const normalize = (file: string) => file.split(path.sep).join('/');

const MODULE_NOT_FOUND_CODES = new Set([2307, 2792]);

function fail(message: string): never {
  console.error(`check-deprecations: ${message}`);
  process.exit(1);
}

const configPath = path.join(root, 'tsconfig.examples.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error != null) {
  fail(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
}

const config = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  root,
  { noEmit: true },
  configPath,
);
if (config.errors.length > 0) {
  fail(
    config.errors
      .map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      .join('\n'),
  );
}
if (config.fileNames.length === 0) {
  fail(`${path.basename(configPath)} matched no files`);
}

// Deprecation lookup
const SDK_DECLARATION = /\/node_modules\/(ai|@ai-sdk\/[^/]+)\//;

function deprecationOf(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): string | undefined {
  if (symbol == null) return undefined;

  let resolved = symbol;
  if (resolved.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = checker.getAliasedSymbol(resolved);
    } catch {
      return undefined;
    }
  }

  const fromSdk = (resolved.declarations ?? []).some(declaration =>
    SDK_DECLARATION.test(normalize(declaration.getSourceFile().fileName)),
  );
  if (!fromSdk) return undefined;

  const tag = resolved
    .getJsDocTags(checker)
    .find(({ name }) => name === 'deprecated');
  if (tag == null) return undefined;

  return ts.displayPartsToString(tag.text ?? []) || '(no replacement given)';
}

/**
 * `const { providerMetadata } = await generateText(...)` binds a fresh local,
 * so the identifier's own symbol carries no deprecation. Look the name up on
 * the type being destructured instead.
 */
function destructuredSymbol(
  checker: ts.TypeChecker,
  node: ts.Identifier,
): ts.Symbol | undefined {
  const element = node.parent;
  if (!ts.isBindingElement(element) || element.name !== node) return undefined;
  if (element.propertyName != null) return undefined;

  const pattern = element.parent;
  if (!ts.isObjectBindingPattern(pattern)) return undefined;

  return checker.getTypeAtLocation(pattern).getProperty(node.text);
}

type Finding = { file: string; line: number; column: number; text: string };

/** Every deprecated AI SDK symbol referenced by `source`. */
function scan(
  program: ts.Program,
  source: ts.SourceFile,
  file: string,
  lineOffset = 0,
): Finding[] {
  const checker = program.getTypeChecker();
  const found: Finding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const text =
        deprecationOf(checker, checker.getSymbolAtLocation(node)) ??
        deprecationOf(checker, destructuredSymbol(checker, node));

      if (text != null) {
        const { line, character } = source.getLineAndCharacterOfPosition(
          node.getStart(),
        );
        found.push({
          file,
          line: line + 1 + lineOffset,
          column: character + 1,
          text: `${node.text} — ${text}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

// Doc snippets
const DOC_FILES = ['README.md'];

const DOC_VOCABULARY = new Map([
  ['interfaze', "import { interfaze } from '@interfaze-ai/ai-sdk';"],
  [
    'createInterfaze',
    "import { createInterfaze } from '@interfaze-ai/ai-sdk';",
  ],
  ['generateText', "import { generateText } from 'ai';"],
  ['streamText', "import { streamText } from 'ai';"],
  ['Output', "import { Output } from 'ai';"],
  ['tool', "import { tool } from 'ai';"],
  ['APICallError', "import { APICallError } from 'ai';"],
  ['NoSuchModelError', "import { NoSuchModelError } from 'ai';"],
  ['z', "import { z } from 'zod/v4';"],
]);

type Snippet = { startLine: number; code: string };

function extractSnippets(markdown: string): Snippet[] {
  const snippets: Snippet[] = [];
  let open: Snippet | undefined;

  markdown.split('\n').forEach((line, index) => {
    if (line.startsWith('```')) {
      if (open != null) {
        snippets.push(open);
        open = undefined;
      } else if (line.startsWith('```ts')) {
        open = { startLine: index + 2, code: '' };
      }
    } else if (open != null) {
      open.code += `${line}\n`;
    }
  });

  return snippets;
}

/** Names the snippet already has in scope, so the preamble cannot clash. */
function boundNames(code: string): Set<string> {
  const parsed = ts.createSourceFile(
    'snippet.ts',
    code,
    ts.ScriptTarget.ES2022,
    true,
  );
  const bound = new Set<string>();

  const collect = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) {
      bound.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collect(element.name);
    }
  };

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name != null) bound.add(clause.name.text);
      if (
        clause?.namedBindings != null &&
        ts.isNamedImports(clause.namedBindings)
      ) {
        for (const element of clause.namedBindings.elements) {
          bound.add(element.name.text);
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collect(declaration.name);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name != null
    ) {
      bound.add(statement.name.text);
    }
  }

  return bound;
}

function preambleFor(code: string): string {
  const bound = boundNames(code);
  return [...DOC_VOCABULARY]
    .filter(
      ([name]) => !bound.has(name) && new RegExp(`\\b${name}\\b`).test(code),
    )
    .map(([, statement]) => statement)
    .join(' ');
}

// Run
const cache = path.join(root, 'node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cache, 'doc-snippets-'));

try {
  const findings: Finding[] = [];

  const program = ts.createProgram(config.fileNames, config.options);

  // A resolution failure makes every symbol unresolvable, which is
  // indistinguishable from "nothing is deprecated" unless we check for it.
  const unresolved = program
    .getSemanticDiagnostics()
    .filter(({ code }) => MODULE_NOT_FOUND_CODES.has(code));
  if (unresolved.length > 0) {
    fail(
      'module resolution failed, so nothing could be checked:\n' +
        unresolved
          .map(d => `  ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
          .join('\n'),
    );
  }

  const sourcePaths = new Set(config.fileNames.map(normalize));
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    if (!sourcePaths.has(normalize(source.fileName))) continue;
    findings.push(
      ...scan(program, source, normalize(path.relative(root, source.fileName))),
    );
  }

  // canary proving the scan still detects
  const CANARY = `${preambleFor('generateText')}
const { providerMetadata } = await generateText({
  model: null as never,
  prompt: 'canary',
});
void providerMetadata;
`;

  const canaryFile = path.join(scratch, 'canary.ts');
  fs.writeFileSync(canaryFile, CANARY);

  const snippets = DOC_FILES.flatMap(source => {
    const absolute = path.join(root, source);
    if (!fs.existsSync(absolute)) fail(`${source} not found`);

    return extractSnippets(fs.readFileSync(absolute, 'utf8')).map(
      (snippet, index) => {
        const file = path.join(
          scratch,
          `${path.basename(source, '.md')}-${index}.ts`,
        );
        fs.writeFileSync(file, `${preambleFor(snippet.code)}\n${snippet.code}`);
        return { file, source, snippet };
      },
    );
  });

  if (snippets.length === 0) fail('no `ts` snippets found in the docs');

  const docProgram = ts.createProgram(
    [canaryFile, ...snippets.map(({ file }) => file)],
    config.options,
  );

  const canarySource = docProgram.getSourceFile(canaryFile);
  if (canarySource == null) fail('could not read the canary snippet');
  if (scan(docProgram, canarySource, 'canary').length === 0) {
    fail(
      'the canary snippet uses a deprecated property and was not flagged — ' +
        'this script is no longer detecting anything',
    );
  }

  for (const { file, source, snippet } of snippets) {
    const parsed = docProgram.getSourceFile(file);
    if (parsed == null) fail(`could not read the scratch file for ${source}`);

    const toReadmeLine = (offset = 0) => snippet.startLine - 2 + offset;

    // Doc snippets must type-check
    const compileErrors = [
      ...docProgram.getSyntacticDiagnostics(parsed),
      ...docProgram.getSemanticDiagnostics(parsed),
    ];
    for (const diagnostic of compileErrors) {
      const at =
        diagnostic.start != null
          ? parsed.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined;
      findings.push({
        file: source,
        line: toReadmeLine(at?.line ?? 1),
        column: (at?.character ?? 0) + 1,
        text: `does not compile — TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      });
    }

    findings.push(...scan(docProgram, parsed, source, snippet.startLine - 2));
  }

  if (findings.length > 0) {
    console.error(`doc-snippet and deprecation issues (${findings.length}):`);
    for (const { file, line, column, text } of findings) {
      console.error(`  ${file}:${line}:${column}  ${text}`);
    }
    process.exit(1);
  }

  console.log(
    `no deprecated AI SDK usage or doc-snippet errors — ` +
      `${config.fileNames.length} sources, ${snippets.length} doc snippets`,
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
