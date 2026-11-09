import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "chunk-graph.mjs")

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function run(root, output) {
  const result = spawnSync(process.execPath, [helper, "--root", root, "--output", output], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  if (result.status !== 0) throw new Error(result.stderr || `helper exited ${result.status}`)
  return JSON.parse(result.stdout || "null")
}

const temporary = await mkdtemp(path.join(tmpdir(), "cachetrust-e1c-graph-test-"))
try {
  const dist = path.join(temporary, "dist")
  await mkdir(dist)
  const entry = path.join(dist, "entry.js")
  const original = `import { value } from "./chunk-AAAA.js"; export { missing } from "./missing.js"; console.log(value);\n`
  await writeFile(entry, original)
  await writeFile(path.join(dist, "chunk-AAAA.js"), "export const value = 1;\n")
  const before = sha256(await readFile(entry))
  const firstOutput = path.join(temporary, "first.json")
  run(dist, firstOutput)
  if (sha256(await readFile(entry)) !== before) throw new Error("helper modified its input")
  const first = JSON.parse(await readFile(firstOutput, "utf8"))
  const firstEntry = first.nodes.find((node) => node.path === "entry.js")
  if (!firstEntry || firstEntry.edges[0].target !== "chunk-AAAA.js" || firstEntry.edges[0].missing) {
    throw new Error("initial chunk reference was not resolved")
  }
  if (!firstEntry.edges.some((edge) => edge.specifier === "./missing.js" && edge.missing)) {
    throw new Error("missing reference was not retained")
  }
  await writeFile(entry, original.replace("chunk-AAAA.js", "chunk-BBBB.js"))
  await writeFile(path.join(dist, "chunk-BBBB.js"), "export const value = 2;\n")
  const secondOutput = path.join(temporary, "second.json")
  run(dist, secondOutput)
  const second = JSON.parse(await readFile(secondOutput, "utf8"))
  const secondEntry = second.nodes.find((node) => node.path === "entry.js")
  if (!secondEntry || !secondEntry.edges.some((edge) => edge.target === "chunk-BBBB.js")) {
    throw new Error("renamed chunk or changed import was not detected")
  }
  if (before !== sha256(Buffer.from(original)) || sha256(await readFile(entry)) === before) {
    throw new Error("fixture integrity assertion failed")
  }
  process.stdout.write("chunk graph synthetic tests passed\n")
} finally {
  await rm(temporary, { recursive: true, force: true })
}
