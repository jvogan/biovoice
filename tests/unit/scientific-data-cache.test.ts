import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionResultSchema,
  downloadScientificAsset,
  resolveScientificAsset,
  resolveFromRoot,
  runScientificWorkflow,
  scientificWorkflowRequestSchema,
  type ScientificWorkflowContext,
  type TargetKind,
} from "../../packages/runtime-and-adapters/src/index.js";

const scientificCacheDir = resolveFromRoot(".runtime", "cache", "scientific");
const cleanupPaths = new Set<string>();

function cachePath(...segments: string[]): string {
  return path.join(scientificCacheDir, ...segments);
}

function track(filePath: string): string {
  cleanupPaths.add(filePath);
  return filePath;
}

function createRuntime() {
  const contexts = new Map<TargetKind, ScientificWorkflowContext>();
  const executedActions = new Map<TargetKind, Array<Record<string, unknown>>>();

  return {
    contexts,
    executedActions,
    runtime: {
      clearWorkflowContext(target: TargetKind) {
        contexts.delete(target);
      },
      setWorkflowContext(target: TargetKind, context: ScientificWorkflowContext) {
        contexts.set(target, context);
      },
      async executeActions(target: TargetKind, actions: Array<Record<string, unknown>>, dryRun?: boolean) {
        executedActions.set(target, [...(executedActions.get(target) ?? []), ...actions]);
        return actionResultSchema.parse({
          target,
          commandsExecuted: actions.map((action) => String(action.type ?? "unknown")),
          logs: [`${target} executed ${actions.length} action(s).`, dryRun ? "Dry run." : "Live run."],
          artifacts: [],
          metrics: [],
          warnings: [],
          state: {
            target,
            dryRun: Boolean(dryRun),
            actionTypes: actions.map((action) => String(action.type ?? "unknown")),
          },
        });
      },
      async getTargetState(target: TargetKind) {
        return {
          target,
          referenceHints: contexts.get(target)?.referenceHints ?? {},
          workflowState: contexts.get(target)?.workflowState ?? {},
        };
      },
    },
  };
}

function jsonResponse(value: unknown): Response {
  const body = JSON.stringify(value);
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "application/json",
    },
  });
}

function textResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: {
      "content-length": String(Buffer.byteLength(value)),
      "content-type": "chemical/x-pdb",
    },
  });
}

function binaryResponse(value: Buffer): Response {
  return new Response(new Uint8Array(value), {
    status: 200,
    headers: {
      "content-length": String(value.byteLength),
      "content-type": "application/octet-stream",
    },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function pdbFixture(chain: string): string {
  return [
    `ATOM      1  N   GLY ${chain}   1      11.104  13.207  14.099  1.00 45.00           N  `,
    `ATOM      2  CA  GLY ${chain}   1      12.560  13.100  14.400  1.00 45.00           C  `,
    `ATOM      3  N   ALA ${chain}   2      13.000  14.300  15.000  1.00 92.00           N  `,
    `ATOM      4  CA  ALA ${chain}   2      14.420  14.100  15.200  1.00 92.00           C  `,
    "END",
  ].join("\n");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function pathCacheKey(filePath: string, stat: { mtimeMs: number; size: number }): string {
  return crypto.createHash("sha1").update(`${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`).digest("hex");
}

async function structureManifestPath(filePath: string): Promise<string | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    return null;
  }
  return cachePath("manifests", `${pathCacheKey(filePath, stat)}.structure.json`);
}

async function cleanupScientificCacheFiles(filePaths: Iterable<string>): Promise<void> {
  for (const filePath of filePaths) {
    const manifestPath = /\.(pdb|ent|cif|mmcif)$/i.test(filePath)
      ? await structureManifestPath(filePath)
      : null;
    if (manifestPath) {
      await fs.rm(manifestPath, { force: true });
    }
    await fs.rm(`${filePath}.manifest.json`, { force: true });
    await fs.rm(filePath, { force: true });
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await cleanupScientificCacheFiles(cleanupPaths);
  cleanupPaths.clear();
});

describe("scientific data fetch cache", () => {
  it("resolves AlphaFold model and PAE assets once through the shared asset resolver", async () => {
    const afdbRecordPath = track(cachePath("alphafold", "TSTRESOLVE.json"));
    const afdbModelPath = track(cachePath("alphafold", "AF-TSTRESOLVE-F1-model_v4.pdb"));
    const afdbPaePath = track(cachePath("alphafold", "AF-TSTRESOLVE-F1-predicted_aligned_error_v4.json"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://alphafold.ebi.ac.uk/api/prediction/TSTRESOLVE") {
        return jsonResponse([
          {
            entryId: "AF-TSTRESOLVE-F1",
            uniprotAccession: "TSTRESOLVE",
            pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-TSTRESOLVE-F1-model_v4.pdb",
            paeDocUrl: "https://alphafold.ebi.ac.uk/files/AF-TSTRESOLVE-F1-predicted_aligned_error_v4.json",
          },
        ]);
      }
      if (url === "https://alphafold.ebi.ac.uk/files/AF-TSTRESOLVE-F1-model_v4.pdb") {
        return textResponse(pdbFixture("A"));
      }
      if (url === "https://alphafold.ebi.ac.uk/files/AF-TSTRESOLVE-F1-predicted_aligned_error_v4.json") {
        return jsonResponse([{ residue1: 1, residue2: 1, distance: 1.2 }]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await resolveScientificAsset({
      source: "alphafold",
      uniprotId: "TSTRESOLVE",
      includePae: true,
    });
    const second = await resolveScientificAsset({
      source: "alphafold",
      uniprotId: "TSTRESOLVE",
      includePae: true,
    });

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "https://alphafold.ebi.ac.uk/api/prediction/TSTRESOLVE",
      "https://alphafold.ebi.ac.uk/files/AF-TSTRESOLVE-F1-model_v4.pdb",
      "https://alphafold.ebi.ac.uk/files/AF-TSTRESOLVE-F1-predicted_aligned_error_v4.json",
    ]);
    expect(first.files.map((file) => file.kind)).toEqual(["model", "pae"]);
    expect(second.files.map((file) => file.cacheHit)).toEqual([true, true]);
    expect(first.files[0]?.path).toBe(afdbModelPath);
    expect(first.files[1]?.path).toBe(afdbPaePath);
    expect(await fs.readFile(afdbRecordPath, "utf8")).toContain("AF-TSTRESOLVE-F1");
  });

  it("resolves gzipped EMDB maps into local map cache files", async () => {
    const emdbMapPath = track(cachePath("emdb", "emd_765432.map"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://ftp.ebi.ac.uk/pub/databases/emdb/structures/EMD-765432/map/emd_765432.map.gz") {
        return binaryResponse(gzipSync(Buffer.from("MAPDATA")));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveScientificAsset({
      source: "emdb",
      emdbId: "EMD-765432",
      includeMetadata: false,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      kind: "map",
      path: emdbMapPath,
      format: "map",
      cacheHit: false,
    });
    expect(await fs.readFile(emdbMapPath, "utf8")).toBe("MAPDATA");
  });

  it("resolves RCSB PDB biological assemblies through the compressed assembly endpoint", async () => {
    const assemblyPath = track(cachePath("pdb", "4HHB-assembly1.pdb"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://files.rcsb.org/download/4HHB.pdb1.gz") {
        return binaryResponse(gzipSync(Buffer.from(pdbFixture("C"))));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveScientificAsset({
      source: "rcsb",
      pdbId: "4HHB",
      assemblyId: "1",
      format: "pdb",
      includeMetadata: false,
    });

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "https://files.rcsb.org/download/4HHB.pdb1.gz",
    ]);
    expect(result.files[0]).toMatchObject({
      kind: "model",
      path: assemblyPath,
      format: "pdb",
      cacheHit: false,
    });
    expect(await fs.readFile(assemblyPath, "utf8")).toContain("GLY C");
  });

  it("enriches RCSB search results with compact entry metadata", async () => {
    const metadataPath = track(cachePath("pdb", "4HHB.metadata.json"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://search.rcsb.org/rcsbsearch/v2/query") {
        return jsonResponse({
          result_set: [
            { identifier: "4HHB", score: 0.91 },
          ],
        });
      }
      if (url === "https://data.rcsb.org/rest/v1/core/entry/4HHB") {
        return jsonResponse({
          struct: { title: "Hemoglobin deoxy form" },
          exptl: [{ method: "X-RAY DIFFRACTION" }],
          rcsb_entry_info: {
            resolution_combined: [1.74],
            polymer_entity_count: 4,
            polymer_entity_count_protein: 4,
          },
          rcsb_accession_info: {
            deposit_date: "1984-03-07T00:00:00+0000",
            initial_release_date: "1984-07-17T00:00:00+0000",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveScientificAsset({
      source: "rcsb_search",
      query: "hemoglobin",
      limit: 1,
    });

    expect(result.searchResults?.[0]).toMatchObject({
      identifier: "4HHB",
      score: 0.91,
      title: "Hemoglobin deoxy form",
      experimentalMethods: ["X-RAY DIFFRACTION"],
      resolutionAngstrom: 1.74,
      polymerEntityCount: 4,
      proteinEntityCount: 4,
      releaseDate: "1984-07-17T00:00:00+0000",
    });
    expect(await fs.readFile(metadataPath, "utf8")).toContain("Hemoglobin deoxy form");
  });

  it("rejects direct scientific downloads from non-allowlisted URLs", async () => {
    await expect(downloadScientificAsset(
      "http://files.rcsb.org/download/4HHB.pdb",
      "pdb",
      "4HHB.pdb",
    )).rejects.toThrow(/must use HTTPS/i);
    await expect(downloadScientificAsset(
      "https://example.com/4HHB.pdb",
      "pdb",
      "4HHB.pdb",
    )).rejects.toThrow(/host is not allowed/i);
    await expect(downloadScientificAsset(
      "https://files.rcsb.org/download/4HHB.pdb",
      "pdb",
      "../4HHB.pdb",
    )).rejects.toThrow(/filename is not allowed/i);
  });

  it("downloads AFDB and RCSB structures once and reuses cached assets on later workflow runs", async () => {
    const afdbRecordPath = track(cachePath("alphafold", "TSTCACHE.json"));
    const afdbModelPath = track(cachePath("alphafold", "AF-TSTCACHE-F1-model_v4.pdb"));
    const rcsbModelPath = track(cachePath("pdb", "9ZZZ.pdb"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://alphafold.ebi.ac.uk/api/prediction/TSTCACHE") {
        return jsonResponse([
          {
            pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-TSTCACHE-F1-model_v4.pdb",
          },
        ]);
      }
      if (url === "https://alphafold.ebi.ac.uk/files/AF-TSTCACHE-F1-model_v4.pdb") {
        return textResponse(pdbFixture("A"));
      }
      if (url === "https://files.rcsb.org/download/9ZZZ.pdb") {
        return textResponse(pdbFixture("B"));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "alphafold_vs_experiment_overlay",
      dryRun: true,
      presentationMode: "demo",
      inputs: {
        uniprotId: "TSTCACHE",
        experimentalPdbId: "9ZZZ",
      },
    });

    const first = await runScientificWorkflow(request, createRuntime().runtime);
    const second = await runScientificWorkflow(request, createRuntime().runtime);

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "https://alphafold.ebi.ac.uk/api/prediction/TSTCACHE",
      "https://alphafold.ebi.ac.uk/files/AF-TSTCACHE-F1-model_v4.pdb",
      "https://files.rcsb.org/download/9ZZZ.pdb",
    ]);
    expect(first.resolvedInputs).toMatchObject({
      modelPath: afdbModelPath,
      modelSource: "afdb",
      experimentalPath: rcsbModelPath,
    });
    expect(second.resolvedInputs).toMatchObject({
      modelPath: afdbModelPath,
      modelSource: "afdb",
      experimentalPath: rcsbModelPath,
    });
    expect(await fs.readFile(afdbRecordPath, "utf8")).toContain("AF-TSTCACHE-F1-model_v4.pdb");
    expect(await fs.readFile(afdbModelPath, "utf8")).toContain("GLY A");
    expect(await fs.readFile(rcsbModelPath, "utf8")).toContain("GLY B");
  });

  it("resolves EMDB ids as cryo map inputs for AlphaFold-to-cryo workflows", async () => {
    const afdbRecordPath = track(cachePath("alphafold", "TSTCRYO.json"));
    const afdbModelPath = track(cachePath("alphafold", "AF-TSTCRYO-F1-model_v4.pdb"));
    const emdbMapPath = track(cachePath("emdb", "emd_654321.map"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://alphafold.ebi.ac.uk/api/prediction/TSTCRYO") {
        return jsonResponse([
          {
            entryId: "AF-TSTCRYO-F1",
            pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-TSTCRYO-F1-model_v4.pdb",
          },
        ]);
      }
      if (url === "https://alphafold.ebi.ac.uk/files/AF-TSTCRYO-F1-model_v4.pdb") {
        return textResponse(pdbFixture("A"));
      }
      if (url === "https://ftp.ebi.ac.uk/pub/databases/emdb/structures/EMD-654321/map/emd_654321.map.gz") {
        return binaryResponse(gzipSync(Buffer.from("CRYOMAP")));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "alphafold_to_cryo_handoff",
      dryRun: true,
      inputs: {
        uniprotId: "TSTCRYO",
        emdbId: "EMD-654321",
      },
    });
    const harness = createRuntime();
    const result = await runScientificWorkflow(request, harness.runtime);

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "https://alphafold.ebi.ac.uk/api/prediction/TSTCRYO",
      "https://alphafold.ebi.ac.uk/files/AF-TSTCRYO-F1-model_v4.pdb",
      "https://ftp.ebi.ac.uk/pub/databases/emdb/structures/EMD-654321/map/emd_654321.map.gz",
    ]);
    expect(result.resolvedInputs).toMatchObject({
      modelPath: afdbModelPath,
      cryoMapPath: emdbMapPath,
    });
    expect(harness.executedActions.get("chimerax")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "open", path: afdbModelPath }),
      expect.objectContaining({ type: "open", path: emdbMapPath }),
    ]));
    expect(await fs.readFile(afdbRecordPath, "utf8")).toContain("AF-TSTCRYO-F1");
    expect(await fs.readFile(emdbMapPath, "utf8")).toBe("CRYOMAP");
  });

  it("rejects AFDB records that point at unapproved download hosts", async () => {
    const afdbRecordPath = track(cachePath("alphafold", "BADHOST.json"));
    await cleanupScientificCacheFiles(cleanupPaths);

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url === "https://alphafold.ebi.ac.uk/api/prediction/BADHOST") {
        return jsonResponse([{ pdbUrl: "https://example.com/AF-BADHOST-F1-model_v4.pdb" }]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      inputs: {
        uniprotId: "BADHOST",
      },
    });

    await expect(runScientificWorkflow(request, createRuntime().runtime)).rejects.toThrow(/download host is not allowed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(afdbRecordPath, "utf8")).toContain("example.com");
  });

  it("uses cached structure analysis sidecars for existing scientific assets", async () => {
    const afdbRecordPath = track(cachePath("alphafold", "SIDECAR.json"));
    const afdbModelPath = track(cachePath("alphafold", "AF-SIDECAR-F1-model_v4.pdb"));
    await cleanupScientificCacheFiles(cleanupPaths);
    await writeText(afdbModelPath, pdbFixture("A"));
    await writeJson(afdbRecordPath, {
      pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-SIDECAR-F1-model_v4.pdb",
    });

    const manifestPath = await structureManifestPath(afdbModelPath);
    expect(manifestPath).toBeTruthy();
    track(manifestPath!);
    await writeJson(manifestPath!, {
      path: afdbModelPath,
      format: "pdb",
      chains: ["Z"],
      residues: [
        {
          index: 0,
          chain: "Z",
          residue: "42",
          residueNumber: 42,
          residueName: "GLY",
          meanConfidence: 12,
        },
      ],
      lowConfidenceRanges: [
        {
          chain: "Z",
          startResidue: "42",
          endResidue: "42",
          residueLabels: ["42"],
          meanValue: 12,
          label: "Preseeded low-confidence region",
        },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      throw new Error(`Unexpected fetch: ${requestUrl(input)}`);
    }));

    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      inputs: {
        uniprotId: "SIDECAR",
      },
    });

    const result = await runScientificWorkflow(request, createRuntime().runtime);

    expect(result.resolvedInputs.chains).toEqual(["Z"]);
    expect(result.referenceHints.lowConfidenceRegion?.selector).toMatchObject({
      object: "af_prediction",
      chain: "Z",
      residues: ["42"],
    });
  });
});
