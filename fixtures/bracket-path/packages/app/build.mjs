import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("src/[id]/page.js", "dist/page.js");
