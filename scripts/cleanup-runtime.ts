import dotenv from "dotenv";
import {
  cleanupRuntimeArtifacts,
  getRuntimeCleanupOptions,
  resolveFromRoot,
} from "../packages/runtime-and-adapters/src/index.js";

dotenv.config({ path: resolveFromRoot(".env") });

const summary = await cleanupRuntimeArtifacts(getRuntimeCleanupOptions());

console.log(JSON.stringify({
  ok: true,
  removedCount: summary.removedPaths.length,
  bytesRecovered: summary.bytesRecovered,
  warnings: summary.warnings,
  removedPaths: summary.removedPaths,
}, null, 2));
