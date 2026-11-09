import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { runProcess } from "../../../dist/process.js"

function parse(argv) {
  const separator = argv.indexOf("--")
  if (separator < 0) throw new Error("missing command separator")
  const options = new Map()
  for (let index = 0; index < separator; index += 2) options.set(argv[index], argv[index + 1])
  for (const name of ["--cwd", "--timeout", "--stdout", "--stderr", "--result"]) {
    if (!options.has(name)) throw new Error(`missing ${name}`)
  }
  const command = argv[separator + 1]
  if (!command) throw new Error("missing command")
  const timeoutMs = Number(options.get("--timeout"))
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout")
  return {
    cwd: path.resolve(options.get("--cwd")),
    timeoutMs,
    stdout: path.resolve(options.get("--stdout")),
    stderr: path.resolve(options.get("--stderr")),
    result: path.resolve(options.get("--result")),
    command,
    args: argv.slice(separator + 2),
  }
}

const options = parse(process.argv.slice(2))
const observation = await runProcess(options.command, options.args, {
  cwd: options.cwd,
  timeoutMs: options.timeoutMs,
})
await mkdir(path.dirname(options.result), { recursive: true })
await writeFile(options.stdout, observation.stdout, { flag: "wx" })
await writeFile(options.stderr, observation.stderr, { flag: "wx" })
await writeFile(options.result, `${JSON.stringify({
  command: observation.command,
  args: observation.args,
  cwd: options.cwd,
  exitCode: observation.exitCode,
  signal: observation.signal,
  timedOut: observation.timedOut,
  durationMs: observation.durationMs,
  stdoutBytes: Buffer.byteLength(observation.stdout),
  stderrBytes: Buffer.byteLength(observation.stderr),
}, null, 2)}\n`, { flag: "wx" })
if (observation.timedOut || observation.exitCode !== 0) process.exitCode = 1
