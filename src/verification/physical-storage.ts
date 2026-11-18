import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PhysicalStorageMeasurement {
  allocatedBytes: bigint;
  logicalBytes: bigint;
  files: number;
  directories: number;
  skippedLinks: number;
  duplicateFileIds: number;
}

const ALLOCATION_BLOCK_BYTES = 512n;

export async function measurePhysicalStorage(root: string): Promise<PhysicalStorageMeasurement> {
  const result: PhysicalStorageMeasurement = {
    allocatedBytes: 0n,
    logicalBytes: 0n,
    files: 0,
    directories: 0,
    skippedLinks: 0,
    duplicateFileIds: 0,
  };
  const seen = new Set<string>();

  const visit = async (path: string, isRoot = false): Promise<void> => {
    const stat = await lstat(path, { bigint: true });
    if (stat.isSymbolicLink()) {
      if (isRoot) throw new Error("Physical storage root cannot be a link");
      result.skippedLinks += 1;
      return;
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new Error(`Unsupported file type in physical storage root: ${path}`);
    }
    const identity = `${stat.dev}:${stat.ino}`;
    if (seen.has(identity)) {
      result.duplicateFileIds += 1;
      return;
    }
    seen.add(identity);
    result.allocatedBytes += stat.blocks * ALLOCATION_BLOCK_BYTES;
    if (stat.isFile()) {
      result.files += 1;
      result.logicalBytes += stat.size;
      return;
    }
    result.directories += 1;
    for (const entry of await readdir(path)) await visit(join(path, entry));
  };

  await visit(root, true);
  return result;
}
