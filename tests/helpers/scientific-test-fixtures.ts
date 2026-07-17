import fs from "node:fs/promises";
import path from "node:path";
import { resolveFromRoot } from "../../packages/runtime-and-adapters/src/utils/paths.js";

export const scientificTestFixtureRunIdEnv = "BIOVOICE_SCIENTIFIC_TEST_FIXTURE_RUN_ID";

export function scientificTestFixturePath(...segments: string[]): string {
  return path.join(scientificTestFixtureRoot(), ...segments);
}

export async function prepareScientificTestFixtures(): Promise<void> {
  const fixtureRoot = scientificTestFixtureRoot();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  const rosettaDir = scientificTestFixturePath("rosetta_demo");
  await fs.mkdir(rosettaDir, { recursive: true });

  const model = buildSyntheticStructure();
  await Promise.all([
    fs.writeFile(scientificTestFixturePath("af-p69905.pdb"), model, "utf8"),
    fs.writeFile(scientificTestFixturePath("variant-model.pdb"), model, "utf8"),
    fs.writeFile(path.join(rosettaDir, "reference_scaffold.pdb"), model, "utf8"),
    fs.writeFile(path.join(rosettaDir, "design_top_a.pdb"), model, "utf8"),
    fs.writeFile(path.join(rosettaDir, "design_top_b.pdb"), model, "utf8"),
    fs.writeFile(
      scientificTestFixturePath("af-p69905-pae.json"),
      `${JSON.stringify([{
        predicted_aligned_error: [
          [0, 2, 8, 9],
          [2, 0, 10, 11],
          [8, 10, 0, 3],
          [9, 11, 3, 0],
        ],
      }])}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(rosettaDir, "score.sc"),
      [
        "SEQUENCE:",
        "SCORE: total_score fa_atr fa_rep fa_sol hbond_sc description",
        "SCORE: -182.450 -345.220 48.110 123.550 -5.220 design_top_a",
        "SCORE: -171.880 -330.910 51.440 128.730 -4.990 design_top_b",
        "",
      ].join("\n"),
      "utf8",
    ),
  ]);
}

export async function cleanupScientificTestFixtures(): Promise<void> {
  await fs.rm(scientificTestFixtureRoot(), { recursive: true, force: true });
}

function scientificTestFixtureRoot(): string {
  const runId = process.env[scientificTestFixtureRunIdEnv];
  if (!runId || !/^[a-f0-9]{32}$/.test(runId)) {
    throw new Error("Scientific test fixtures require the Vitest global setup run id.");
  }
  return resolveFromRoot(
    ".runtime",
    "tests",
    `portable-scientific-fixtures-${runId}`,
  );
}

function buildSyntheticStructure(): string {
  return [
    formatPdbAtom("ATOM", 1, "CA", "GLY", "A", 1, 92),
    formatPdbAtom("ATOM", 2, "CA", "HIS", "A", 58, 45),
    formatPdbAtom("ATOM", 3, "CA", "GLY", "B", 1, 88),
    formatPdbAtom("ATOM", 4, "CA", "HIS", "B", 58, 50),
    formatPdbAtom("HETATM", 5, "FE", "HEM", "A", 201, 30, "FE"),
    "END",
    "",
  ].join("\n");
}

function formatPdbAtom(
  record: "ATOM" | "HETATM",
  serial: number,
  atomName: string,
  residueName: string,
  chain: string,
  residueNumber: number,
  bFactor: number,
  element = atomName.slice(0, 1),
): string {
  const x = serial * 1.5;
  const y = serial * 0.75;
  const z = serial * -0.5;
  return [
    record.padEnd(6),
    String(serial).padStart(5),
    " ",
    atomName.padStart(4),
    " ",
    residueName.padStart(3),
    " ",
    chain,
    String(residueNumber).padStart(4),
    "    ",
    x.toFixed(3).padStart(8),
    y.toFixed(3).padStart(8),
    z.toFixed(3).padStart(8),
    "  1.00",
    bFactor.toFixed(2).padStart(6),
    "          ",
    element.padStart(2),
  ].join("");
}
