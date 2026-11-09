import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const cacheDir = args[args.indexOf("--cache-dir") + 1];
await mkdir(cacheDir, { recursive: true });
await mkdir("dist", { recursive: true });
await mkdir(join(".turbo", "runs"), { recursive: true });

const artifact = join(cacheDir, "artifact.txt");
let hit = true;
try {
  await copyFile(artifact, join("dist", "output.txt"));
} catch {
  hit = false;
  await writeFile(join("dist", "output.txt"), await readFile("input.txt"));
  await copyFile(join("dist", "output.txt"), artifact);
}

await writeFile(join(".turbo", "runs", `${Date.now()}-${Math.random()}.json`), JSON.stringify({
  turboVersion: "1.0.0",
  tasks: [{
    taskId: "app#build",
    hash: "example-input-hash",
    directory: "",
    cache: { status: hit ? "HIT" : "MISS", local: hit, remote: false },
    outputs: ["dist/**"],
    excludedOutputs: [],
  }],
}));
