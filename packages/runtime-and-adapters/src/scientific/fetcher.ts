import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { runtimeDir } from "../utils/paths.js";

export const scientificCacheDir = path.join(runtimeDir, "cache", "scientific");

const modelDownloadHosts = new Set([
  "alphafold.ebi.ac.uk",
  "files.rcsb.org",
]);

const metadataHosts = new Set([
  "alphafold.ebi.ac.uk",
  "data.rcsb.org",
  "search.rcsb.org",
  "rest.uniprot.org",
  "www.ebi.ac.uk",
]);

const mapDownloadHosts = new Set([
  "ftp.ebi.ac.uk",
  "files.wwpdb.org",
]);

const maxModelDownloadBytes = 64 * 1024 * 1024;
const maxMetadataDownloadBytes = 8 * 1024 * 1024;
const maxMapDownloadBytes = 512 * 1024 * 1024;
const scientificCacheBuckets = new Set([
  "alphafold",
  "emdb",
  "manifests",
  "pae",
  "pdb",
  "rosetta",
  "uniprot",
]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxScientificRedirects = 5;

export type ScientificAssetSource = "alphafold" | "rcsb" | "rcsb_search" | "emdb" | "uniprot";
export type StructureAssetFormat = "pdb" | "cif";

export interface ScientificAssetFile {
  kind: "model" | "pae" | "map" | "metadata";
  path: string;
  label: string;
  sourceUrl: string;
  format?: string;
  bytes: number;
  sha256: string;
  cacheHit: boolean;
}

export interface ScientificAssetResolution {
  source: ScientificAssetSource;
  id: string;
  label: string;
  files: ScientificAssetFile[];
  metadata?: Record<string, unknown>;
  searchResults?: Array<Record<string, unknown>>;
  warnings: string[];
}

export type ScientificAssetResolveRequest =
  | {
    source: "alphafold";
    uniprotId: string;
    format?: StructureAssetFormat;
    includePae?: boolean;
  }
  | {
    source: "rcsb";
    pdbId: string;
    format?: StructureAssetFormat;
    assemblyId?: string;
    includeMetadata?: boolean;
  }
  | {
    source: "rcsb_search";
    query: string;
    limit?: number;
  }
  | {
    source: "emdb";
    emdbId: string;
    includeMetadata?: boolean;
  }
  | {
    source: "uniprot";
    accession?: string;
    query?: string;
    limit?: number;
  };

export interface AlphaFoldResolvedAsset {
  uniprotId: string;
  record: Record<string, string | number | boolean | unknown>;
  modelPath: string;
  paePath?: string;
  files: ScientificAssetFile[];
}

export interface RcsbResolvedStructure {
  pdbId: string;
  path: string;
  format: StructureAssetFormat;
  files: ScientificAssetFile[];
  metadata?: Record<string, unknown>;
}

export interface EmdbResolvedMap {
  emdbId: string;
  path: string;
  files: ScientificAssetFile[];
  metadata?: Record<string, unknown>;
}

export async function ensureScientificCacheDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(path.join(scientificCacheDir, "alphafold"), { recursive: true }),
    fs.mkdir(path.join(scientificCacheDir, "emdb"), { recursive: true }),
    fs.mkdir(path.join(scientificCacheDir, "pdb"), { recursive: true }),
    fs.mkdir(path.join(scientificCacheDir, "pae"), { recursive: true }),
    fs.mkdir(path.join(scientificCacheDir, "rosetta"), { recursive: true }),
    fs.mkdir(path.join(scientificCacheDir, "manifests"), { recursive: true }),
    fs.mkdir(path.join(scientificCacheDir, "uniprot"), { recursive: true }),
  ]);
}

export async function resolveScientificAsset(request: ScientificAssetResolveRequest): Promise<ScientificAssetResolution> {
  switch (request.source) {
    case "alphafold": {
      const asset = await resolveAlphaFoldAsset(request.uniprotId, {
        format: request.format,
        includePae: request.includePae,
      });
      return {
        source: "alphafold",
        id: asset.uniprotId,
        label: `AlphaFold ${asset.uniprotId}`,
        files: asset.files,
        metadata: compactRecord(asset.record),
        warnings: [],
      };
    }
    case "rcsb": {
      const asset = await resolveRcsbStructure(request.pdbId, {
        format: request.format,
        assemblyId: request.assemblyId,
        includeMetadata: request.includeMetadata,
      });
      return {
        source: "rcsb",
        id: asset.pdbId,
        label: `RCSB ${asset.pdbId}`,
        files: asset.files,
        metadata: asset.metadata,
        warnings: [],
      };
    }
    case "rcsb_search": {
      const searchResults = await searchRcsb(request.query, request.limit);
      return {
        source: "rcsb_search",
        id: request.query.trim(),
        label: `RCSB search: ${request.query.trim()}`,
        files: [],
        searchResults,
        warnings: searchResults.length ? [] : ["No RCSB search results were returned."],
      };
    }
    case "emdb": {
      const asset = await resolveEmdbMap(request.emdbId, {
        includeMetadata: request.includeMetadata,
      });
      return {
        source: "emdb",
        id: asset.emdbId,
        label: `EMDB ${asset.emdbId}`,
        files: asset.files,
        metadata: asset.metadata,
        warnings: [],
      };
    }
    case "uniprot": {
      const result = await resolveUniProt(request);
      return {
        source: "uniprot",
        id: String(result.id),
        label: String(result.label),
        files: result.file ? [result.file] : [],
        metadata: result.metadata,
        searchResults: result.searchResults,
        warnings: [],
      };
    }
  }
}

export async function resolveAlphaFoldAsset(
  uniprotId: string,
  options: { format?: StructureAssetFormat; includePae?: boolean } = {},
): Promise<AlphaFoldResolvedAsset> {
  await ensureScientificCacheDirs();
  const normalized = normalizeUniProtId(uniprotId);
  const record = await resolveAlphaFoldRecord(normalized);
  const format = options.format ?? "pdb";
  const modelUrl = chooseAlphaFoldModelUrl(record, format);
  const modelFile = await downloadScientificAssetDetailed(
    modelUrl,
    "alphafold",
    scientificDownloadFilenameFromUrl(modelUrl),
    {
      kind: "model",
      label: `AlphaFold model ${normalized}`,
      maxBytes: maxModelDownloadBytes,
    },
  );
  const files = [modelFile];
  let paePath: string | undefined;
  if (options.includePae !== false && typeof record.paeDocUrl === "string") {
    const paeFile = await downloadScientificAssetDetailed(
      record.paeDocUrl,
      "alphafold",
      scientificDownloadFilenameFromUrl(record.paeDocUrl),
      {
        kind: "pae",
        label: `AlphaFold PAE ${normalized}`,
        maxBytes: maxMetadataDownloadBytes,
      },
    );
    paePath = paeFile.path;
    files.push(paeFile);
  }
  return {
    uniprotId: normalized,
    record,
    modelPath: modelFile.path,
    paePath,
    files,
  };
}

export async function resolveAlphaFoldRecord(uniprotId: string): Promise<Record<string, string | number | boolean | unknown>> {
  await ensureScientificCacheDirs();
  const normalized = normalizeUniProtId(uniprotId);
  const cachePath = path.join(scientificCacheDir, "alphafold", `${normalized}.json`);
  const cached = await readJsonFile(cachePath).catch(() => null);
  if (cached) {
    return cached as Record<string, string | number | boolean | unknown>;
  }

  const { response } = await fetchScientificMetadata(`https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    throw new Error(`AlphaFold DB lookup failed for ${normalized}: ${response.status}`);
  }
  const payload = await readBoundedJsonResponse(response, `AlphaFold DB lookup for ${normalized}`) as Array<Record<string, string | number | boolean | unknown>>;
  const record = payload[0];
  if (!record?.pdbUrl && !record?.cifUrl) {
    throw new Error(`AlphaFold DB did not return a model URL for ${normalized}.`);
  }
  await writeJsonFile(cachePath, record);
  return record;
}

export async function resolveRcsbStructure(
  pdbId: string,
  options: { format?: StructureAssetFormat; assemblyId?: string; includeMetadata?: boolean } = {},
): Promise<RcsbResolvedStructure> {
  await ensureScientificCacheDirs();
  const normalized = normalizePdbId(pdbId);
  const format = options.format ?? "cif";
  const download = buildRcsbStructureDownload(normalized, format, options.assemblyId);
  const file = await downloadScientificAssetDetailed(
    download.url,
    "pdb",
    download.filename,
    {
      kind: "model",
      label: `RCSB ${normalized}${download.labelSuffix}`,
      maxBytes: maxModelDownloadBytes,
      gunzip: download.gunzip,
    },
  );
  const files = [file];
  const metadata = options.includeMetadata === false ? undefined : await fetchRcsbEntryMetadata(normalized).catch((error) => ({
    warning: error instanceof Error ? error.message : String(error),
  }));
  return {
    pdbId: normalized,
    path: file.path,
    format,
    files,
    metadata,
  };
}

export async function fetchRcsbEntryMetadata(pdbId: string): Promise<Record<string, unknown>> {
  await ensureScientificCacheDirs();
  const normalized = normalizePdbId(pdbId);
  const cachePath = path.join(scientificCacheDir, "pdb", `${normalized}.metadata.json`);
  const cached = await readJsonFile(cachePath).catch(() => null);
  if (cached) {
    return cached as Record<string, unknown>;
  }
  const { response } = await fetchScientificMetadata(`https://data.rcsb.org/rest/v1/core/entry/${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    throw new Error(`RCSB metadata lookup failed for ${normalized}: ${response.status}`);
  }
  const payload = await readBoundedJsonResponse(response, `RCSB metadata for ${normalized}`) as Record<string, unknown>;
  await writeJsonFile(cachePath, payload);
  return payload;
}

export async function searchRcsb(query: string, limit = 5): Promise<Array<Record<string, unknown>>> {
  await ensureScientificCacheDirs();
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 240) {
    throw new Error("RCSB search query must be 1-240 characters.");
  }
  const cappedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const { response } = await fetchScientificMetadata("https://search.rcsb.org/rcsbsearch/v2/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: {
        type: "terminal",
        service: "full_text",
        parameters: {
          value: trimmed,
        },
      },
      return_type: "entry",
      request_options: {
        paginate: {
          start: 0,
          rows: cappedLimit,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`RCSB search failed for ${trimmed}: ${response.status}`);
  }
  const payload = await readBoundedJsonResponse(response, `RCSB search for ${trimmed}`) as { result_set?: Array<Record<string, unknown>> };
  const candidates = (payload.result_set ?? []).slice(0, cappedLimit);
  return Promise.all(candidates.map(async (candidate) => {
    const identifier = typeof candidate.identifier === "string" ? candidate.identifier : undefined;
    const normalizedId = identifier ? tryNormalizePdbId(identifier) : undefined;
    if (!normalizedId) {
      return compactRcsbSearchCandidate(candidate);
    }
    const metadata = await fetchRcsbEntryMetadata(normalizedId).catch((error) => ({
      warning: error instanceof Error ? error.message : String(error),
    }));
    return compactRcsbSearchCandidate(candidate, metadata);
  }));
}

export async function resolveEmdbMap(
  emdbId: string,
  options: { includeMetadata?: boolean } = {},
): Promise<EmdbResolvedMap> {
  await ensureScientificCacheDirs();
  const normalized = normalizeEmdbId(emdbId);
  const numeric = normalized.replace(/^EMD-/i, "");
  const filename = `emd_${numeric}.map`;
  const file = await downloadScientificAssetDetailed(
    `https://ftp.ebi.ac.uk/pub/databases/emdb/structures/${normalized}/map/${filename}.gz`,
    "emdb",
    filename,
    {
      kind: "map",
      label: `EMDB map ${normalized}`,
      maxBytes: maxMapDownloadBytes,
      gunzip: true,
    },
  );
  const metadata = options.includeMetadata === false ? undefined : await fetchEmdbMetadata(normalized).catch((error) => ({
    warning: error instanceof Error ? error.message : String(error),
  }));
  return {
    emdbId: normalized,
    path: file.path,
    files: [file],
    metadata,
  };
}

export async function fetchEmdbMetadata(emdbId: string): Promise<Record<string, unknown>> {
  await ensureScientificCacheDirs();
  const normalized = normalizeEmdbId(emdbId);
  const cachePath = path.join(scientificCacheDir, "emdb", `${normalized}.metadata.json`);
  const cached = await readJsonFile(cachePath).catch(() => null);
  if (cached) {
    return cached as Record<string, unknown>;
  }
  const { response } = await fetchScientificMetadata(`https://www.ebi.ac.uk/emdb/api/entry/${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    throw new Error(`EMDB metadata lookup failed for ${normalized}: ${response.status}`);
  }
  const payload = await readBoundedJsonResponse(response, `EMDB metadata for ${normalized}`) as Record<string, unknown>;
  await writeJsonFile(cachePath, payload);
  return payload;
}

export async function resolveUniProt(
  request: Extract<ScientificAssetResolveRequest, { source: "uniprot" }>,
): Promise<{
  id: string;
  label: string;
  file?: ScientificAssetFile;
  metadata?: Record<string, unknown>;
  searchResults?: Array<Record<string, unknown>>;
}> {
  await ensureScientificCacheDirs();
  if (request.accession?.trim()) {
    const accession = normalizeUniProtId(request.accession);
    const cachePath = path.join(scientificCacheDir, "uniprot", `${accession}.json`);
    const cached = await readJsonFile(cachePath).catch(() => null);
    if (cached) {
      return {
        id: accession,
        label: `UniProt ${accession}`,
        metadata: cached as Record<string, unknown>,
      };
    }
    const { response } = await fetchScientificMetadata(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json`);
    if (!response.ok) {
      throw new Error(`UniProt lookup failed for ${accession}: ${response.status}`);
    }
    const payload = await readBoundedJsonResponse(response, `UniProt lookup for ${accession}`) as Record<string, unknown>;
    await writeJsonFile(cachePath, payload);
    return {
      id: accession,
      label: `UniProt ${accession}`,
      metadata: payload,
    };
  }

  const query = request.query?.trim();
  if (!query || query.length > 240) {
    throw new Error("UniProt resolver requires an accession or a 1-240 character query.");
  }
  const cappedLimit = Math.max(1, Math.min(25, Math.trunc(request.limit ?? 5)));
  const url = new URL("https://rest.uniprot.org/uniprotkb/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(cappedLimit));
  url.searchParams.set("fields", "accession,id,protein_name,gene_names,organism_name,reviewed,length");
  const { response } = await fetchScientificMetadata(url);
  if (!response.ok) {
    throw new Error(`UniProt search failed for ${query}: ${response.status}`);
  }
  const payload = await readBoundedJsonResponse(response, `UniProt search for ${query}`) as { results?: Array<Record<string, unknown>> };
  return {
    id: query,
    label: `UniProt search: ${query}`,
    searchResults: (payload.results ?? []).slice(0, cappedLimit),
  };
}

export async function downloadScientificAsset(url: string, bucket: string, filename: string): Promise<string> {
  const detailed = await downloadScientificAssetDetailed(url, bucket, filename, {
    kind: "model",
    label: filename,
    maxBytes: bucket === "emdb" ? maxMapDownloadBytes : maxModelDownloadBytes,
    gunzip: url.endsWith(".gz") && !filename.endsWith(".gz"),
  });
  return detailed.path;
}

export async function downloadScientificAssetDetailed(
  url: string,
  bucket: string,
  filename: string,
  options: {
    kind: ScientificAssetFile["kind"];
    label: string;
    maxBytes: number;
    gunzip?: boolean;
  },
): Promise<ScientificAssetFile> {
  await ensureScientificCacheDirs();
  const parsedUrl = validateScientificDownloadUrl(url, options.kind);
  const safeFilename = validateScientificDownloadFilename(filename);
  const safeBucket = validateScientificCacheBucket(bucket);
  const bucketDir = path.join(scientificCacheDir, safeBucket);
  const destination = path.join(bucketDir, safeFilename);
  const normalizedBucketDir = path.resolve(bucketDir);
  const normalizedDestination = path.resolve(destination);
  if (normalizedDestination !== normalizedBucketDir && !normalizedDestination.startsWith(`${normalizedBucketDir}${path.sep}`)) {
    throw new Error(`Scientific download target escaped the ${bucket} cache.`);
  }
  const existing = await getCachedFile(destination, options.kind, options.label, parsedUrl.toString());
  if (existing) {
    return existing;
  }

  const { response, finalUrl } = await fetchScientificDownload(
    parsedUrl,
    options.kind,
    options.kind === "map" ? 180_000 : 60_000,
  );
  if (!response.ok) {
    throw new Error(`Failed to download ${finalUrl.toString()}: ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw new Error(`Scientific download exceeds the ${options.maxBytes} byte safety limit.`);
  }
  const bytes = await readBoundedResponseBuffer(response, finalUrl.toString(), options.maxBytes);
  let outputBytes: Buffer;
  try {
    outputBytes = options.gunzip
      ? gunzipSync(bytes, { maxOutputLength: options.maxBytes })
      : bytes;
  } catch (error) {
    if (options.gunzip) {
      throw new Error(
        `Scientific download could not be safely decompressed within the ${options.maxBytes} byte limit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
  if (outputBytes.length > options.maxBytes) {
    throw new Error(`Scientific download exceeded the ${options.maxBytes} byte safety limit after decompression.`);
  }
  await fs.mkdir(bucketDir, { recursive: true });
  const tempPath = `${destination}.part-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, outputBytes, { mode: 0o600 });
    await fs.rename(tempPath, destination);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
  const file = await describeCachedFile(destination, options.kind, options.label, finalUrl.toString(), false);
  await writeJsonFile(`${destination}.manifest.json`, {
    ...file,
    fetchedAt: new Date().toISOString(),
  });
  return file;
}

export function scientificDownloadFilenameFromUrl(value: string): string {
  const parsed = new URL(value);
  const basename = path.basename(parsed.pathname);
  return validateScientificDownloadFilename(basename);
}

export function validateScientificDownloadUrl(value: string, kind: ScientificAssetFile["kind"] = "model"): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`Scientific downloads must use HTTPS: ${parsed.toString()}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = kind === "map"
    ? mapDownloadHosts
    : kind === "metadata"
    ? metadataHosts
    : kind === "pae"
    ? new Set(["alphafold.ebi.ac.uk"])
    : modelDownloadHosts;
  if (!allowedHosts.has(hostname)) {
    throw new Error(`Scientific download host is not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

export function validateScientificDownloadFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || path.basename(trimmed) !== trimmed || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`Scientific download filename is not allowed: ${value}`);
  }
  return trimmed;
}

function validateScientificCacheBucket(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!scientificCacheBuckets.has(normalized)) {
    throw new Error(`Scientific cache bucket is not allowed: ${value}`);
  }
  return normalized;
}

async function fetchScientificDownload(
  initialUrl: URL,
  kind: ScientificAssetFile["kind"],
  timeoutMs: number,
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = initialUrl;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirectCount = 0; redirectCount <= maxScientificRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal,
    });
    if (!redirectStatuses.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Scientific download redirect from ${currentUrl.toString()} did not include a Location header.`);
    }
    if (redirectCount >= maxScientificRedirects) {
      throw new Error(`Scientific download exceeded the ${maxScientificRedirects}-redirect safety limit.`);
    }
    currentUrl = validateScientificDownloadUrl(new URL(location, currentUrl).toString(), kind);
  }

  throw new Error(`Scientific download exceeded the ${maxScientificRedirects}-redirect safety limit.`);
}

async function fetchScientificMetadata(
  initialUrl: string | URL,
  init: RequestInit = {},
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = validateScientificDownloadUrl(initialUrl.toString(), "metadata");
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const signal = AbortSignal.timeout(20_000);

  for (let redirectCount = 0; redirectCount <= maxScientificRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      ...init,
      method,
      body,
      redirect: "manual",
      signal,
    });
    if (!redirectStatuses.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Scientific metadata redirect from ${currentUrl.toString()} did not include a Location header.`);
    }
    if (redirectCount >= maxScientificRedirects) {
      throw new Error(`Scientific metadata request exceeded the ${maxScientificRedirects}-redirect safety limit.`);
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
      method = "GET";
      body = undefined;
    }
    currentUrl = validateScientificDownloadUrl(new URL(location, currentUrl).toString(), "metadata");
  }

  throw new Error(`Scientific metadata request exceeded the ${maxScientificRedirects}-redirect safety limit.`);
}

async function readBoundedJsonResponse(response: Response, label: string): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxMetadataDownloadBytes) {
    throw new Error(`${label} exceeded the ${maxMetadataDownloadBytes} byte metadata limit.`);
  }
  const bytes = await readBoundedResponseBuffer(response, label, maxMetadataDownloadBytes);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function chooseAlphaFoldModelUrl(record: Record<string, string | number | boolean | unknown>, format: StructureAssetFormat): string {
  if (format === "cif" && typeof record.cifUrl === "string") {
    return record.cifUrl;
  }
  if (format === "pdb" && typeof record.pdbUrl === "string") {
    return record.pdbUrl;
  }
  if (typeof record.pdbUrl === "string") {
    return record.pdbUrl;
  }
  if (typeof record.cifUrl === "string") {
    return record.cifUrl;
  }
  throw new Error("AlphaFold DB response did not include a downloadable model URL.");
}

function normalizePdbId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(normalized)) {
    throw new Error("PDB id must be a 4-character accession.");
  }
  return normalized;
}

function normalizeUniProtId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(normalized)) {
    throw new Error("UniProt accession must be 1-40 safe identifier characters.");
  }
  return normalized;
}

function normalizeEmdbId(value: string): string {
  const trimmed = value.trim().toUpperCase();
  const match = /^EMD[-_]?(\d{3,8})$/.exec(trimmed) ?? /^(\d{3,8})$/.exec(trimmed);
  if (!match) {
    throw new Error("EMDB id must look like EMD-1234.");
  }
  return `EMD-${match[1]}`;
}

function validateAssemblyId(value: string): string {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]{0,3}$/.test(trimmed)) {
    throw new Error("Assembly id must be a safe short identifier.");
  }
  return trimmed;
}

function tryNormalizePdbId(value: string): string | undefined {
  try {
    return normalizePdbId(value);
  } catch {
    return undefined;
  }
}

function buildRcsbStructureDownload(
  pdbId: string,
  format: StructureAssetFormat,
  assemblyId?: string,
): { url: string; filename: string; labelSuffix: string; gunzip?: boolean } {
  const assembly = assemblyId?.trim() ? validateAssemblyId(assemblyId) : undefined;
  if (!assembly) {
    const filename = `${pdbId}.${format}`;
    return {
      url: `https://files.rcsb.org/download/${filename}`,
      filename,
      labelSuffix: "",
    };
  }

  if (format === "pdb") {
    return {
      url: `https://files.rcsb.org/download/${pdbId}.pdb${assembly}.gz`,
      filename: `${pdbId}-assembly${assembly}.pdb`,
      labelSuffix: ` assembly ${assembly}`,
      gunzip: true,
    };
  }

  const filename = `${pdbId}-assembly${assembly}.cif`;
  return {
    url: `https://files.rcsb.org/download/${filename}`,
    filename,
    labelSuffix: ` assembly ${assembly}`,
  };
}

function compactRcsbSearchCandidate(
  candidate: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  const identifier = typeof candidate.identifier === "string"
    ? candidate.identifier.toUpperCase()
    : typeof candidate.id === "string"
    ? candidate.id.toUpperCase()
    : undefined;
  const result: Record<string, unknown> = {
    identifier,
    score: typeof candidate.score === "number" ? candidate.score : undefined,
  };

  if (metadata) {
    const struct = isRecord(metadata.struct) ? metadata.struct : undefined;
    const entryInfo = isRecord(metadata.rcsb_entry_info) ? metadata.rcsb_entry_info : undefined;
    const accession = isRecord(metadata.rcsb_accession_info) ? metadata.rcsb_accession_info : undefined;
    const experimentalMethods = Array.isArray(metadata.exptl)
      ? metadata.exptl
        .map((entry) => isRecord(entry) && typeof entry.method === "string" ? entry.method : undefined)
        .filter((method): method is string => Boolean(method))
      : undefined;
    result.title = typeof struct?.title === "string" ? struct.title : undefined;
    result.experimentalMethods = experimentalMethods?.length ? experimentalMethods : undefined;
    result.resolutionAngstrom = Array.isArray(entryInfo?.resolution_combined)
      ? entryInfo.resolution_combined.find((value) => typeof value === "number")
      : undefined;
    result.polymerEntityCount = typeof entryInfo?.polymer_entity_count === "number" ? entryInfo.polymer_entity_count : undefined;
    result.proteinEntityCount = typeof entryInfo?.polymer_entity_count_protein === "number" ? entryInfo.polymer_entity_count_protein : undefined;
    result.depositionDate = typeof accession?.deposit_date === "string" ? accession.deposit_date : undefined;
    result.releaseDate = typeof accession?.initial_release_date === "string" ? accession.initial_release_date : undefined;
    result.metadataWarning = typeof metadata.warning === "string" ? metadata.warning : undefined;
  }

  return compactUndefined(result);
}

function compactUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getCachedFile(
  destination: string,
  kind: ScientificAssetFile["kind"],
  label: string,
  sourceUrl: string,
): Promise<ScientificAssetFile | null> {
  const stat = await fs.stat(destination).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }
  return describeCachedFile(destination, kind, label, sourceUrl, true);
}

async function describeCachedFile(
  filePath: string,
  kind: ScientificAssetFile["kind"],
  label: string,
  sourceUrl: string,
  cacheHit: boolean,
): Promise<ScientificAssetFile> {
  const bytes = await fs.readFile(filePath);
  return {
    kind,
    path: filePath,
    label,
    sourceUrl,
    format: inferFormat(filePath, kind),
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    cacheHit,
  };
}

async function readBoundedResponseBuffer(response: Response, label: string, maxBytes: number): Promise<Buffer> {
  const body = response.body;
  if (!body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error(`Scientific download exceeded the ${maxBytes} byte safety limit for ${label}.`);
    }
    return bytes;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      await reader.cancel(`Scientific download exceeded ${maxBytes} bytes for ${label}.`).catch(() => {});
      throw new Error(`Scientific download exceeded the ${maxBytes} byte safety limit.`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks, totalBytes);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function inferFormat(filePath: string, kind: ScientificAssetFile["kind"]): string {
  const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (extension) {
    return extension;
  }
  return kind;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "entryId",
    "uniprotAccession",
    "uniprotId",
    "gene",
    "organismScientificName",
    "proteinDescription",
    "modelCreatedDate",
    "latestVersion",
    "allVersions",
    "isReviewed",
    "isReferenceProteome",
    "pdbUrl",
    "cifUrl",
    "paeDocUrl",
  ];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}
