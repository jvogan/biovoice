import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import { getExampleCatalog } from "../packages/runtime-and-adapters/src/examples/index.js";
import { localDataDir } from "../packages/runtime-and-adapters/src/utils/paths.js";

const execFileAsync = promisify(execFile);

async function main() {
  await fs.mkdir(localDataDir, { recursive: true });

  const uniqueDownloads = new Map<string, { url: string; label: string }>();
  for (const recipe of getExampleCatalog()) {
    for (const item of recipe.sampleData) {
      if (!item.localPath) {
        continue;
      }

      const remoteUrl = await resolveRemoteUrl(item);
      if (remoteUrl) {
        uniqueDownloads.set(item.localPath, { url: remoteUrl, label: item.label });
      }
    }
  }

  const failures: string[] = [];

  for (const [localPath, download] of uniqueDownloads) {
    const exists = await fs.access(localPath).then(() => true).catch(() => false);
    if (exists) {
      continue;
    }

    console.log(`Downloading ${download.label} to ${path.basename(localPath)}`);
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    try {
      await downloadWithCurl(download.url, localPath);
    } catch (error) {
      failures.push(`${localPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to prepare ${failures.length} demo asset(s):\n${failures.join("\n")}`);
  }
}

async function resolveRemoteUrl(item: { id: string; kind: string; remoteUrl?: string }) {
  if (item.kind === "alphafold") {
    return resolveAlphaFoldDownload(item.id, item.remoteUrl);
  }

  return item.remoteUrl ?? null;
}

async function resolveAlphaFoldDownload(accession: string, fallbackUrl?: string): Promise<string> {
  try {
    const response = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(accession)}`, {
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`AlphaFold API returned ${response.status}`);
    }

    const payload = await response.json() as Array<{ pdbUrl?: string }>;
    const pdbUrl = payload[0]?.pdbUrl;
    if (!pdbUrl) {
      throw new Error("AlphaFold API response did not include a pdbUrl.");
    }

    return pdbUrl;
  } catch (error) {
    if (fallbackUrl) {
      console.warn(`Falling back to static AlphaFold URL for ${accession}: ${error instanceof Error ? error.message : String(error)}`);
      return fallbackUrl;
    }

    throw error;
  }
}

async function downloadWithCurl(url: string, destination: string) {
  const tempPath = `${destination}.part`;
  const shouldGunzip = url.endsWith(".gz") && !destination.endsWith(".gz");
  try {
    await execFileAsync("curl", [
      "-fL",
      "--retry",
      "5",
      "--retry-all-errors",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "20",
      "--max-time",
      "180",
      "--output",
      tempPath,
      url,
    ]);
    if (shouldGunzip) {
      await pipeline(
        createReadStream(tempPath),
        createGunzip(),
        createWriteStream(destination),
      );
      await fs.rm(tempPath, { force: true });
    } else {
      await fs.rename(tempPath, destination);
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

void main();
