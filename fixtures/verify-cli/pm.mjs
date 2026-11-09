import { mkdir, writeFile } from "node:fs/promises";

if (process.argv.includes("--version")) {
  console.log("1.0.0");
} else {
  await mkdir("node_modules", { recursive: true });
  await writeFile("node_modules/.cachetrust-installed", "fixture\n");
}
