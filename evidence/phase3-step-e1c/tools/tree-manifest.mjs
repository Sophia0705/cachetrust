import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"

if (process.argv.length !== 5 || process.argv[2] !== "--root") {
  process.stderr.write("usage: node tree-manifest.mjs --root <root> <output>\n")
  process.exit(1)
}

const root = await realpath(path.resolve(process.argv[3]))
const output = path.resolve(process.argv[4] ?? "")
const files = []
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    const stats = await lstat(absolute)
    if (stats.isSymbolicLink()) throw new Error(`symlink is not supported: ${absolute}`)
    if (entry.isDirectory()) await visit(absolute)
    else if (entry.isFile()) files.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") })
  }
}
await visit(root)
files.sort((left, right) => left.relative.localeCompare(right.relative))
const rows = []
let totalBytes = 0
for (const file of files) {
  const bytes = await readFile(file.absolute)
  totalBytes += bytes.length
  rows.push(`${file.relative}\t${bytes.length}\t${createHash("sha256").update(bytes).digest("hex")}`)
}
const contract = `${rows.join("\n")}\n`
const manifest = {
  schemaVersion: "1",
  root,
  fileCount: rows.length,
  totalBytes,
  sha256: createHash("sha256").update(contract).digest("hex"),
}
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" })
