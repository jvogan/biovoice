import { z } from "zod";

const FORBIDDEN_COMMAND_TEXT_PATTERN = /[;\r\n"'`\\]/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:#@+\-/*]+$/;
const SAFE_SELECTOR_PATTERN = /^[^;\r\n"`\\]+$/;
const SAFE_RESIDUE_PATTERN = /^[A-Za-z0-9_.:+\-*]+$/;
const SAFE_COLOR_PATTERN = /^[^;\r\n"`\\]+$/;

function buildSafeCommandStringSchema(maxLength: number, label: string, pattern: RegExp) {
  return z.string().min(1).max(maxLength).transform((value) => value.trim()).refine((value) => {
    return Boolean(value) && !FORBIDDEN_COMMAND_TEXT_PATTERN.test(value) && pattern.test(value);
  }, {
    message: `${label} contains unsupported characters for structured command dispatch.`,
  });
}

export function buildSafeIdentifierSchema(maxLength: number, label: string) {
  return buildSafeCommandStringSchema(maxLength, label, SAFE_IDENTIFIER_PATTERN);
}

export function buildSafeSelectionExpressionSchema(maxLength: number, label: string) {
  return buildSafeCommandStringSchema(maxLength, label, SAFE_SELECTOR_PATTERN);
}

export function buildSafeResidueTokenSchema(maxLength: number, label: string) {
  return buildSafeCommandStringSchema(maxLength, label, SAFE_RESIDUE_PATTERN);
}

export function buildSafeColorTokenSchema(maxLength: number, label: string) {
  return buildSafeCommandStringSchema(maxLength, label, SAFE_COLOR_PATTERN);
}

export function buildSafeMetadataTextSchema(maxLength: number, label: string) {
  return z.string().min(1).max(maxLength).transform((value) => value.trim()).refine((value) => {
    return Boolean(value) && !/[;\r\n`\\]/.test(value);
  }, {
    message: `${label} contains unsupported control characters.`,
  });
}

export const selectorObjectSchema = z.object({
  reference: buildSafeIdentifierSchema(80, "selector reference").optional(),
  object: buildSafeIdentifierSchema(80, "selector object").optional(),
  model: buildSafeIdentifierSchema(80, "selector model").optional(),
  chain: buildSafeIdentifierSchema(12, "selector chain").optional(),
  chains: z.array(buildSafeIdentifierSchema(12, "selector chain")).min(1).max(24).optional(),
  residue: buildSafeResidueTokenSchema(80, "selector residue").optional(),
  residues: z.array(buildSafeResidueTokenSchema(80, "selector residue")).min(1).max(64).optional(),
  atom: buildSafeIdentifierSchema(40, "selector atom").optional(),
  ligand: buildSafeIdentifierSchema(40, "selector ligand").optional(),
  entity: z.enum(["protein", "nucleic", "polymer", "organic", "solvent", "ions", "backbone", "sidechain"]).optional(),
  around: buildSafeSelectionExpressionSchema(200, "selector around").optional(),
  withinAngstroms: z.number().min(0.5).max(50).optional(),
  byResidue: z.boolean().optional(),
});

export type SelectorObject = z.infer<typeof selectorObjectSchema>;

export interface SelectorReferenceHint {
  selector: string | SelectorObject;
}

export type SelectorReferenceMap = Record<string, SelectorReferenceHint | undefined>;

export function compilePymolSelection(
  selection?: string | SelectorObject | null,
  referenceHints?: SelectorReferenceMap,
): string {
  if (!selection) {
    return "all";
  }

  if (typeof selection === "string") {
    return selection;
  }

  const resolved = resolveSelectorReference(selection, referenceHints, "pymol");
  if (typeof resolved === "string") {
    return resolved;
  }

  const parts: string[] = [];
  const chainTerms = uniqueTerms([resolved.chain, ...(resolved.chains ?? [])]);
  const residueTerms = uniqueTerms([resolved.residue, ...(resolved.residues ?? [])]);

  if (resolved.object) parts.push(resolved.object);
  if (resolved.model) parts.push(resolved.model);
  if (chainTerms.length) parts.push(`chain ${chainTerms.join("+")}`);
  if (residueTerms.length) parts.push(`resi ${residueTerms.join("+")}`);
  if (resolved.atom) parts.push(`name ${resolved.atom}`);
  if (resolved.ligand) parts.push(`resn ${resolved.ligand}`);
  if (resolved.entity) parts.push(mapPymolEntity(resolved.entity));

  const base = parts.length ? parts.join(" and ") : "all";

  if (resolved.around && resolved.withinAngstroms) {
    const shell = `(${resolved.around}) around ${resolved.withinAngstroms}`;
    return resolved.byResidue ? `byres (${base} and ${shell})` : `${base} and ${shell}`;
  }

  return resolved.byResidue ? `byres (${base})` : base;
}

export function compileChimeraXAtomspec(
  selection?: string | SelectorObject | null,
  referenceHints?: SelectorReferenceMap,
): string {
  if (!selection) {
    return "sel";
  }

  if (typeof selection === "string") {
    return selection;
  }

  const resolved = resolveSelectorReference(selection, referenceHints, "chimerax");
  if (typeof resolved === "string") {
    return resolved;
  }

  const chainTerms = uniqueTerms([resolved.chain, ...(resolved.chains ?? [])]);
  const residueTerms = uniqueTerms([resolved.residue, ...(resolved.residues ?? [])]);
  let prefix = resolved.model ?? resolved.object ?? "";
  if (chainTerms.length) prefix += `/${chainTerms.join(",")}`;
  if (residueTerms.length) prefix += `:${residueTerms.join(",")}`;
  if (resolved.atom) prefix += `@${resolved.atom}`;
  if (resolved.ligand) prefix += `:${resolved.ligand}`;
  if (resolved.entity) {
    prefix = prefix ? `${prefix} & ${mapChimeraXEntity(resolved.entity)}` : mapChimeraXEntity(resolved.entity);
  }

  const base = prefix || "sel";

  if (resolved.around && resolved.withinAngstroms) {
    return `${base} & zone ${resolved.around} range ${resolved.withinAngstroms}`;
  }

  return base;
}

export function selectorUsesReference(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => selectorUsesReference(entry));
  }

  const record = value as Record<string, unknown>;
  if (typeof record.reference === "string" && record.reference.trim()) {
    return true;
  }

  return Object.values(record).some((entry) => selectorUsesReference(entry));
}

function uniqueTerms(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms;
}

function resolveSelectorReference(
  selection: SelectorObject,
  referenceHints: SelectorReferenceMap | undefined,
  target: "pymol" | "chimerax",
): string | SelectorObject {
  if (!selection.reference) {
    return selection;
  }

  const hint = referenceHints?.[selection.reference];
  if (!hint) {
    return withoutReference(selection);
  }

  const overlay = withoutReference(selection);
  const overlayHasTerms = hasSelectorTerms(overlay);
  const base = hint.selector;

  if (typeof base === "string") {
    if (!overlayHasTerms) {
      return base;
    }

    const overlaySelection = compileSelectorOverlay(overlay, target);
    if (!overlaySelection) {
      return base;
    }
    return target === "pymol" ? `(${base}) and ${overlaySelection}` : `(${base}) & ${overlaySelection}`;
  }

  return {
    ...base,
    ...overlay,
    chains: overlay.chains ?? base.chains,
    residues: overlay.residues ?? base.residues,
  };
}

function withoutReference(selection: SelectorObject): SelectorObject {
  const { reference: _reference, ...rest } = selection;
  return rest;
}

function hasSelectorTerms(selection: SelectorObject): boolean {
  return Object.values(selection).some((value) => value !== undefined);
}

function compileSelectorOverlay(selection: SelectorObject, target: "pymol" | "chimerax"): string {
  if (target === "chimerax") {
    const chainTerms = uniqueTerms([selection.chain, ...(selection.chains ?? [])]);
    const residueTerms = uniqueTerms([selection.residue, ...(selection.residues ?? [])]);
    let prefix = selection.model ?? selection.object ?? "";
    if (chainTerms.length) prefix += `/${chainTerms.join(",")}`;
    if (residueTerms.length) prefix += `:${residueTerms.join(",")}`;
    if (selection.atom) prefix += `@${selection.atom}`;
    if (selection.ligand) prefix += `:${selection.ligand}`;
    if (selection.entity) {
      prefix = prefix ? `${prefix} & ${mapChimeraXEntity(selection.entity)}` : mapChimeraXEntity(selection.entity);
    }
    const scoped = prefix || "sel";
    if (selection.around && selection.withinAngstroms) {
      return `${scoped} & zone ${selection.around} range ${selection.withinAngstroms}`;
    }
    return scoped;
  }

  const parts: string[] = [];
  const chainTerms = uniqueTerms([selection.chain, ...(selection.chains ?? [])]);
  const residueTerms = uniqueTerms([selection.residue, ...(selection.residues ?? [])]);

  if (selection.object) parts.push(selection.object);
  if (selection.model) parts.push(selection.model);
  if (chainTerms.length) parts.push(target === "pymol" ? `chain ${chainTerms.join("+")}` : chainTerms.length === 1 ? `/${chainTerms[0]}` : `/${chainTerms.join(",")}`);
  if (residueTerms.length) parts.push(target === "pymol" ? `resi ${residueTerms.join("+")}` : `:${residueTerms.join(",")}`);
  if (selection.atom) parts.push(target === "pymol" ? `name ${selection.atom}` : `@${selection.atom}`);
  if (selection.ligand) parts.push(target === "pymol" ? `resn ${selection.ligand}` : `:${selection.ligand}`);
  if (selection.entity) parts.push(target === "pymol" ? mapPymolEntity(selection.entity) : mapChimeraXEntity(selection.entity));

  const base = parts
    .filter(Boolean)
    .map((part) => part.trim())
    .join(" and ");

  if (selection.around && selection.withinAngstroms) {
    if (target === "pymol") {
      const shell = `(${selection.around}) around ${selection.withinAngstroms}`;
      const scoped = base || "all";
      return selection.byResidue ? `byres (${scoped} and ${shell})` : `${scoped} and ${shell}`;
    }
    const scoped = base || "sel";
    return `${scoped} & zone ${selection.around} range ${selection.withinAngstroms}`;
  }

  return selection.byResidue && base ? `byres (${base})` : base;
}

function mapPymolEntity(entity: SelectorObject["entity"]): string {
  switch (entity) {
    case "protein":
      return "polymer.protein";
    case "nucleic":
      return "polymer.nucleic";
    case "polymer":
      return "polymer";
    case "organic":
      return "organic";
    case "solvent":
      return "solvent";
    case "ions":
      return "inorganic";
    case "backbone":
      return "backbone";
    case "sidechain":
      return "sidechain";
    default:
      return "all";
  }
}

function mapChimeraXEntity(entity: SelectorObject["entity"]): string {
  switch (entity) {
    case "protein":
      return "protein";
    case "nucleic":
      return "nucleic";
    case "polymer":
      return "polymer";
    case "organic":
      return "ligand";
    case "solvent":
      return "solvent";
    case "ions":
      return "ions";
    case "backbone":
      return "backbone";
    case "sidechain":
      return "sidechain";
    default:
      return "sel";
  }
}
