import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TemporaryWorkspace {
  root: string;
  fixture: string;
  cache: string;
  cleanup(): Promise<void>;
}

export async function createTemporaryWorkspace(fixturePath: string): Promise<TemporaryWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "cachetrust-"));
  const fixture = join(root, "workspace");
  const cache = join(root, "cache");

  try {
    await cp(fixturePath, fixture, { recursive: true, errorOnExist: true });
    await mkdir(cache);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    root,
    fixture,
    cache,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function withTemporaryWorkspace<T>(
  fixturePath: string,
  run: (workspace: TemporaryWorkspace) => Promise<T>,
): Promise<T> {
  const workspace = await createTemporaryWorkspace(fixturePath);
  try {
    return await run(workspace);
  } finally {
    await workspace.cleanup();
  }
}
