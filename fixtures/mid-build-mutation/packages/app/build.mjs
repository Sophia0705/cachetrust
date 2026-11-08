import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { watch } from "node:fs";

const ready = ".cachetrust-ready";
const proceed = ".cachetrust-continue";

await writeFile(ready, "ready\n");
await access(proceed).catch(() => new Promise((resolve, reject) => {
  const watcher = watch(".", async (_event, name) => {
    if (name !== proceed) return;
    try {
      await access(proceed);
      watcher.close();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
  watcher.on("error", reject);
}));
await mkdir("dist", { recursive: true });
await cp("src/a.txt", "dist/o.txt");
