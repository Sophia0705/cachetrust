import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

const EXPECTED_TYPESCRIPT = "5.9.2"

function argumentsFrom(argv) {
  if (argv.length !== 4 || argv[0] !== "--root" || argv[2] !== "--output") {
    throw new Error("usage: node chunk-graph.mjs --root <absolute-dist-root> --output <absolute-json-path>")
  }
  const root = path.resolve(argv[1])
  const output = path.resolve(argv[3])
  if (!path.isAbsolute(argv[1]) || !path.isAbsolute(argv[3])) throw new Error("root and output must be absolute")
  if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error("output must be outside root")
  return { root, output }
}

function portable(value) {
  return value.split(path.sep).join("/")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function javascriptFiles(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const stats = await lstat(absolute)
      if (stats.isSymbolicLink() || stats.isDirectory() && (stats.mode & 0o170000) !== 0o040000
          || stats.isFile() && (stats.mode & 0o170000) !== 0o100000) {
        throw new Error(`unsupported file type: ${portable(path.relative(root, absolute))}`)
      }
      if ((stats.mode & 0o170000) === 0o120000 || stats.isSymbolicLink()) {
        throw new Error(`reparse point or symlink: ${portable(path.relative(root, absolute))}`)
      }
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute)
    }
  }
  await visit(root)
  return files.sort((left, right) => portable(path.relative(root, left)).localeCompare(portable(path.relative(root, right))))
}

function bindingsForImport(node, ts) {
  const bindings = []
  const clause = node.importClause
  if (!clause) return bindings
  if (clause.name) bindings.push({ imported: "default", local: clause.name.text })
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    bindings.push({ imported: "*", local: clause.namedBindings.name.text })
  } else if (clause.namedBindings) {
    for (const element of clause.namedBindings.elements) {
      bindings.push({ imported: element.propertyName?.text ?? element.name.text, local: element.name.text })
    }
  }
  return bindings
}

function bindingsForExport(node) {
  if (!node.exportClause) return [{ imported: "*", exported: "*" }]
  return node.exportClause.elements.map((element) => ({
    imported: element.propertyName?.text ?? element.name.text,
    exported: element.name.text,
  }))
}

function exportedNames(source, ts) {
  const names = new Set()
  function addBinding(name) {
    if (ts.isIdentifier(name)) names.add(name.text)
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(element.name)
    }
  }
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.add("default")
    if (statement.name) names.add(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) addBinding(declaration.name)
    }
  }
  return [...names].sort()
}

function resolveSpecifier(root, importer, specifier, known) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return { target: null, external: true, missing: false }
  }
  const candidate = path.resolve(path.dirname(importer), specifier)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error(`import escapes root: ${specifier}`)
  for (const value of [candidate, `${candidate}.js`, path.join(candidate, "index.js")]) {
    if (known.has(value)) return { target: portable(path.relative(root, value)), external: false, missing: false }
  }
  return { target: portable(path.relative(root, candidate)), external: false, missing: true }
}

function edgesFor(source, importer, root, known, ts) {
  const edges = []
  function add(node, kind, literal, bindings) {
    const specifier = literal.text
    edges.push({
      kind,
      specifier,
      ...resolveSpecifier(root, importer, specifier, known),
      bindings,
      offset: node.getStart(source),
    })
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, "import", node.moduleSpecifier, bindingsForImport(node, ts))
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, "export-from", node.moduleSpecifier, bindingsForExport(node))
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      add(node, "dynamic-import", node.arguments[0], [])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edges.sort((left, right) => left.offset - right.offset || left.specifier.localeCompare(right.specifier))
}

async function main() {
  const { root: requestedRoot, output } = argumentsFrom(process.argv.slice(2))
  const root = await realpath(requestedRoot)
  const outputParent = path.dirname(output)
  await access(root, constants.R_OK)
  const require = createRequire(path.join(process.cwd(), "package.json"))
  const ts = require("typescript")
  if (ts.version !== EXPECTED_TYPESCRIPT) throw new Error(`expected TypeScript ${EXPECTED_TYPESCRIPT}, observed ${ts.version}`)
  const files = await javascriptFiles(root)
  const known = new Set(files)
  const nodes = []
  for (const file of files) {
    const bytes = await readFile(file)
    const text = bytes.toString("utf8")
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    if (source.parseDiagnostics.length > 0) throw new Error(`parse failed: ${portable(path.relative(root, file))}`)
    nodes.push({
      path: portable(path.relative(root, file)),
      bytes: bytes.length,
      sha256: sha256(bytes),
      exports: exportedNames(source, ts),
      edges: edgesFor(source, file, root, known, ts),
    })
  }
  const evidence = {
    schemaVersion: "cachetrust.e1c.chunk-graph/1",
    runtime: { node: process.version, typescript: ts.version },
    root,
    nodeCount: nodes.length,
    edgeCount: nodes.reduce((count, node) => count + node.edges.length, 0),
    nodes,
  }
  await mkdir(outputParent, { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
