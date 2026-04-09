type SelectorValue = string | Record<string, unknown>;

export interface ReferenceHint {
  label: string;
  selector: SelectorValue;
  reason?: string;
  aliases?: string[];
}

export interface SceneAnnotation {
  aliases?: string[];
  classifications?: string[];
}

export interface SemanticDescriptor {
  key: string;
  name: string;
  type?: string;
  classifications: string[];
  aliases?: string[];
}

export interface SemanticReferenceSummary {
  descriptors: SemanticDescriptor[];
  handles: Record<string, ReferenceHint>;
  chainHandles: Array<{ label: string; selector: SelectorValue; aliases?: string[] }>;
  selectionHandles: Array<{ label: string; selector: SelectorValue; aliases?: string[] }>;
}

export function buildPymolReferenceSummary(input: {
  molecularObjectNames: string[];
  mapObjectNames: string[];
  selectionNames: string[];
  visibleChains: string[];
  chainsByObject?: Record<string, string[]>;
  ligandAtomCount?: number;
  annotations?: Record<string, SceneAnnotation | undefined>;
}): SemanticReferenceSummary {
  const descriptors = input.molecularObjectNames.map((name) => createSemanticDescriptor(name, name, undefined, input.annotations));
  const primary = pickPrimaryStructure(descriptors);
  const predicted = pickByClassification(descriptors, "predicted");
  const experimental = pickExperimentalStructure(descriptors, primary);
  const design = pickByClassification(descriptors, "design");
  const scaffold = pickByClassification(descriptors, "scaffold") ?? experimental;
  const binder = pickByClassification(descriptors, "binder");
  const receptor = pickByClassification(descriptors, "receptor") ?? experimental;
  const partner = binder ?? pickSecondaryStructure(descriptors, primary, [experimental, predicted, design, scaffold, receptor]);
  const handles: Record<string, ReferenceHint> = {};

  if (primary) {
    handles.wholeStructure = {
      label: "whole structure",
      selector: { object: primary.name },
      reason: `${primary.name} is the main molecular object in the current PyMOL scene.`,
      aliases: ["whole structure", "entire structure", "full structure", "main structure"],
    };
    handles.wholeComplex = {
      label: "whole complex",
      selector: { object: primary.name },
      reason: `${primary.name} is the best current complex-level handle.`,
      aliases: ["whole complex", "entire complex", "full complex", "assembly", "whole assembly"],
    };
    handles.visibleProtein = {
      label: "visible protein",
      selector: { object: primary.name, entity: "protein" },
      reason: `Use ${primary.name} when the user means the currently visible protein scaffold or complex.`,
      aliases: ["visible protein", "protein", "protein assembly", "protein model"],
    };
    handles.assemblyModel = {
      label: "assembly or full complex",
      selector: { object: primary.name },
      reason: `${primary.name} is the best handle when the user refers to the full assembly, oligomer, or entire complex.`,
      aliases: ["assembly", "full assembly", "oligomer", "entire assembly", "whole assembly"],
    };
    if (typeof input.ligandAtomCount === "number" && input.ligandAtomCount > 0) {
      handles.ligandContext = {
        label: "ligand context",
        selector: `${primary.name} and organic`,
        reason: `The main structure ${primary.name} currently includes ligand atoms.`,
        aliases: ["ligand context", "ligand", "binding site", "active site ligand"],
      };
      handles.ligandNeighborhood = {
        label: "ligand neighborhood",
        selector: { object: primary.name, around: `${primary.name} and organic`, withinAngstroms: 5, byResidue: true },
        reason: `Use the ligand neighborhood around ${primary.name} when the scientist asks for the pocket shell or local binding site.`,
        aliases: ["ligand neighborhood", "pocket shell", "binding pocket", "binding-site shell", "local pocket"],
      };
    }
  }

  if (experimental) {
    handles.experimentalModel = {
      label: "experimental model",
      selector: { object: experimental.name },
      reason: `${experimental.name} looks like the current experimental or reference structure.`,
      aliases: ["experimental model", "experimental structure", "crystal structure", "cryo structure", "reference experiment"],
    };
    handles.referenceModel = {
      label: "reference model",
      selector: { object: experimental.name },
      reason: `${experimental.name} is the current best experimental or reference-model handle.`,
      aliases: ["reference model", "reference structure", "starting structure", "native reference"],
    };
  }
  if (predicted) {
    handles.predictedModel = {
      label: "predicted model",
      selector: { object: predicted.name },
      reason: `${predicted.name} looks like an AlphaFold or predicted model.`,
      aliases: ["predicted model", "prediction", "alphafold model", "af model", "predicted structure"],
    };
  }
  if (design) {
    handles.designModel = {
      label: "design model",
      selector: { object: design.name },
      reason: `${design.name} looks like a designed or Rosetta-style variant.`,
      aliases: ["design model", "rosetta design", "designed variant", "candidate design", "designed structure"],
    };
  }
  if (scaffold) {
    handles.scaffoldModel = {
      label: "scaffold or reference model",
      selector: { object: scaffold.name },
      reason: `${scaffold.name} looks like the reference or scaffold structure.`,
      aliases: ["scaffold", "scaffold model", "wild-type scaffold", "wt scaffold", "reference scaffold"],
    };
  }
  if (binder) {
    handles.binderModel = {
      label: "binder model",
      selector: { object: binder.name },
      reason: `${binder.name} looks like a binder-like partner.`,
      aliases: ["binder", "binder model", "binding partner", "designed binder", "partner model"],
    };
  }
  if (receptor) {
    handles.receptorModel = {
      label: "receptor or target model",
      selector: { object: receptor.name },
      reason: `${receptor.name} looks like the receptor or main target structure.`,
      aliases: ["receptor", "target", "target model", "receptor model", "host model"],
    };
  }
  if (partner) {
    handles.partnerModel = {
      label: "partner or comparison model",
      selector: { object: partner.name },
      reason: `${partner.name} is the best current comparison or partner model after the main reference structure.`,
      aliases: ["partner", "comparison partner", "comparison model", "other model"],
    };
  }
  if (input.mapObjectNames[0]) {
    handles.map = {
      label: "map",
      selector: { object: input.mapObjectNames[0] },
      reason: `${input.mapObjectNames[0]} is the active density or map object.`,
      aliases: ["map", "density map", "density", "cryo map", "volume"],
    };
  }

  const primaryChains = primary
    ? uniqueTerms(input.chainsByObject?.[primary.name] ?? input.visibleChains).slice(0, 8)
    : [];
  if (primary && primaryChains[0]) {
    handles.partnerA = {
      label: `partner chain ${primaryChains[0]}`,
      selector: { object: primary.name, chain: primaryChains[0] },
      reason: `${primary.name} chain ${primaryChains[0]} is the first chain-level partner handle in the assembly.`,
      aliases: ["first partner", "partner A", `chain ${primaryChains[0]}`],
    };
  }
  if (primary && primaryChains[1]) {
    handles.partnerB = {
      label: `partner chain ${primaryChains[1]}`,
      selector: { object: primary.name, chain: primaryChains[1] },
      reason: `${primary.name} chain ${primaryChains[1]} is the second chain-level partner handle in the assembly.`,
      aliases: ["second partner", "partner B", `chain ${primaryChains[1]}`],
    };
    handles.interfacePair = {
      label: `interface pair ${primaryChains[0]}-${primaryChains[1]}`,
      selector: { object: primary.name, chains: [primaryChains[0], primaryChains[1]] },
      reason: `${primary.name} chains ${primaryChains[0]} and ${primaryChains[1]} are the default interface pair for chain-level partner requests.`,
      aliases: ["interface pair", "both partners", "partner pair", "interface chains"],
    };
  }

  const chainHandles = buildPymolChainHandles(
    primary,
    experimental,
    predicted,
    design,
    scaffold,
    binder,
    receptor,
    input.chainsByObject ?? {},
    input.visibleChains,
  );
  addPymolDescriptorChainReferenceHandles(handles, [
    { keyPrefix: "experimental", labelPrefix: "experimental model", descriptor: experimental, aliasPrefixes: ["experimental model", "reference model"] },
    { keyPrefix: "reference", labelPrefix: "reference model", descriptor: experimental, aliasPrefixes: ["reference model", "starting structure"] },
    { keyPrefix: "predicted", labelPrefix: "predicted model", descriptor: predicted, aliasPrefixes: ["predicted model", "alphafold model"] },
    { keyPrefix: "design", labelPrefix: "design model", descriptor: design, aliasPrefixes: ["design model", "rosetta design"] },
    { keyPrefix: "scaffold", labelPrefix: "scaffold model", descriptor: scaffold, aliasPrefixes: ["scaffold", "reference scaffold", "wt scaffold"] },
    { keyPrefix: "binder", labelPrefix: "binder model", descriptor: binder, aliasPrefixes: ["binder", "binding partner"] },
    { keyPrefix: "receptor", labelPrefix: "receptor model", descriptor: receptor, aliasPrefixes: ["receptor", "target model"] },
    { keyPrefix: "partner", labelPrefix: "partner model", descriptor: partner, aliasPrefixes: ["partner", "comparison model"] },
  ], input.chainsByObject ?? {});
  const selectionHandles = input.selectionNames.slice(0, 8).map((selectionName) => ({
    label: selectionName,
    selector: selectionName,
    aliases: [selectionName, selectionName.replaceAll("_", " ")],
  }));
  if (selectionHandles[0]) {
    handles.currentSelection = {
      label: "current named selection",
      selector: selectionHandles[0].selector,
      reason: `${selectionHandles[0].label} is the first active named selection in the scene.`,
      aliases: ["current selection", "named selection", selectionHandles[0].label],
    };
  }

  return {
    descriptors,
    handles,
    chainHandles,
    selectionHandles,
  };
}

export function buildChimeraXReferenceSummary(input: {
  models: Array<{ id: string; type: string; name: string }>;
  chains: Array<{ chain: string; summary: string }>;
  namedViews: string[];
  annotations?: Record<string, SceneAnnotation | undefined>;
}): SemanticReferenceSummary {
  const structureDescriptors = input.models
    .filter((model) => /atomic/i.test(model.type))
    .map((model) => createSemanticDescriptor(model.id, model.name, model.type, input.annotations));
  const mapModels = input.models.filter((model) => /volume|map/i.test(model.type));
  const primary = pickPrimaryStructure(structureDescriptors);
  const predicted = pickByClassification(structureDescriptors, "predicted");
  const experimental = pickExperimentalStructure(structureDescriptors, primary);
  const design = pickByClassification(structureDescriptors, "design");
  const scaffold = pickByClassification(structureDescriptors, "scaffold") ?? experimental;
  const binder = pickByClassification(structureDescriptors, "binder");
  const receptor = pickByClassification(structureDescriptors, "receptor") ?? experimental;
  const partner = binder ?? pickSecondaryStructure(structureDescriptors, primary, [experimental, predicted, design, scaffold, receptor]);
  const handles: Record<string, ReferenceHint> = {};

  if (primary) {
    handles.wholeStructure = {
      label: "whole structure",
      selector: { model: primary.key },
      reason: `${primary.key} ${primary.name} is the main current structure model.`,
      aliases: ["whole structure", "entire structure", "full structure", "main structure"],
    };
    handles.wholeComplex = {
      label: "whole complex",
      selector: { model: primary.key },
      reason: `${primary.key} ${primary.name} is the best current complex-level handle.`,
      aliases: ["whole complex", "entire complex", "full complex", "assembly", "whole assembly"],
    };
    handles.visibleProtein = {
      label: "visible protein",
      selector: { model: primary.key, entity: "protein" },
      reason: `Use ${primary.key} when the user means the visible protein scaffold or assembly.`,
      aliases: ["visible protein", "protein", "protein assembly", "protein model"],
    };
    handles.assemblyModel = {
      label: "assembly or full complex",
      selector: { model: primary.key },
      reason: `${primary.key} ${primary.name} is the best handle for the whole assembly or full complex.`,
      aliases: ["assembly", "full assembly", "oligomer", "entire assembly", "whole assembly"],
    };
    handles.ligandContext = {
      label: "ligand context",
      selector: `${primary.key} & ligand`,
      reason: `Use the ligand within ${primary.key} when the user asks for the ligand environment or binding site.`,
      aliases: ["ligand context", "ligand", "binding site", "active site ligand"],
    };
    handles.ligandNeighborhood = {
      label: "ligand neighborhood",
      selector: { model: primary.key, around: `${primary.key} & ligand`, withinAngstroms: 5, byResidue: true },
      reason: `Use the ligand neighborhood around ${primary.key} when the scientist asks for the pocket shell or local binding site.`,
      aliases: ["ligand neighborhood", "pocket shell", "binding pocket", "binding-site shell", "local pocket"],
    };
  }

  if (experimental) {
    handles.experimentalModel = {
      label: "experimental model",
      selector: { model: experimental.key },
      reason: `${experimental.key} ${experimental.name} looks like the experimental or reference structure.`,
      aliases: ["experimental model", "experimental structure", "crystal structure", "cryo structure", "reference experiment"],
    };
    handles.referenceModel = {
      label: "reference model",
      selector: { model: experimental.key },
      reason: `${experimental.key} ${experimental.name} is the current best experimental or reference-model handle.`,
      aliases: ["reference model", "reference structure", "starting structure", "native reference"],
    };
  }
  if (predicted) {
    handles.predictedModel = {
      label: "predicted model",
      selector: { model: predicted.key },
      reason: `${predicted.key} ${predicted.name} looks like an AlphaFold or predicted model.`,
      aliases: ["predicted model", "prediction", "alphafold model", "af model", "predicted structure"],
    };
  }
  if (design) {
    handles.designModel = {
      label: "design model",
      selector: { model: design.key },
      reason: `${design.key} ${design.name} looks like a designed or Rosetta-style model.`,
      aliases: ["design model", "rosetta design", "designed variant", "candidate design", "designed structure"],
    };
  }
  if (scaffold) {
    handles.scaffoldModel = {
      label: "scaffold or reference model",
      selector: { model: scaffold.key },
      reason: `${scaffold.key} ${scaffold.name} looks like the scaffold or reference structure.`,
      aliases: ["scaffold", "scaffold model", "wild-type scaffold", "wt scaffold", "reference scaffold"],
    };
  }
  if (binder) {
    handles.binderModel = {
      label: "binder model",
      selector: { model: binder.key },
      reason: `${binder.key} ${binder.name} looks like a binder-like partner.`,
      aliases: ["binder", "binder model", "binding partner", "designed binder", "partner model"],
    };
  }
  if (receptor) {
    handles.receptorModel = {
      label: "receptor or target model",
      selector: { model: receptor.key },
      reason: `${receptor.key} ${receptor.name} looks like the receptor or main target structure.`,
      aliases: ["receptor", "target", "target model", "receptor model", "host model"],
    };
  }
  if (partner) {
    handles.partnerModel = {
      label: "partner or comparison model",
      selector: { model: partner.key },
      reason: `${partner.key} ${partner.name} is the best current comparison or partner model after the main reference structure.`,
      aliases: ["partner", "comparison partner", "comparison model", "other model"],
    };
  }
  if (mapModels[0]) {
    handles.map = {
      label: "map",
      selector: mapModels[0].id,
      reason: `${mapModels[0].id} ${mapModels[0].name} is the current density or map model.`,
      aliases: ["map", "density map", "density", "cryo map", "volume"],
    };
  }
  const chainsByModel = groupChimeraXChains(input.chains);
  const primaryChains = primary ? uniqueTerms(chainsByModel[primary.key] ?? []).slice(0, 8) : [];
  if (primary && primaryChains[0]) {
    handles.partnerA = {
      label: `partner chain ${primaryChains[0]}`,
      selector: { model: primary.key, chain: primaryChains[0] },
      reason: `${primary.key} chain ${primaryChains[0]} is the first chain-level partner handle in the assembly.`,
      aliases: ["first partner", "partner A", `chain ${primaryChains[0]}`],
    };
  }
  if (primary && primaryChains[1]) {
    handles.partnerB = {
      label: `partner chain ${primaryChains[1]}`,
      selector: { model: primary.key, chain: primaryChains[1] },
      reason: `${primary.key} chain ${primaryChains[1]} is the second chain-level partner handle in the assembly.`,
      aliases: ["second partner", "partner B", `chain ${primaryChains[1]}`],
    };
    handles.interfacePair = {
      label: `interface pair ${primaryChains[0]}-${primaryChains[1]}`,
      selector: { model: primary.key, chains: [primaryChains[0], primaryChains[1]] },
      reason: `${primary.key} chains ${primaryChains[0]} and ${primaryChains[1]} are the default interface pair for chain-level partner requests.`,
      aliases: ["interface pair", "both partners", "partner pair", "interface chains"],
    };
  }

  addChimeraXDescriptorChainReferenceHandles(handles, [
    { keyPrefix: "experimental", labelPrefix: "experimental model", descriptor: experimental, aliasPrefixes: ["experimental model", "reference model"] },
    { keyPrefix: "reference", labelPrefix: "reference model", descriptor: experimental, aliasPrefixes: ["reference model", "starting structure"] },
    { keyPrefix: "predicted", labelPrefix: "predicted model", descriptor: predicted, aliasPrefixes: ["predicted model", "alphafold model"] },
    { keyPrefix: "design", labelPrefix: "design model", descriptor: design, aliasPrefixes: ["design model", "rosetta design"] },
    { keyPrefix: "scaffold", labelPrefix: "scaffold model", descriptor: scaffold, aliasPrefixes: ["scaffold", "reference scaffold", "wt scaffold"] },
    { keyPrefix: "binder", labelPrefix: "binder model", descriptor: binder, aliasPrefixes: ["binder", "binding partner"] },
    { keyPrefix: "receptor", labelPrefix: "receptor model", descriptor: receptor, aliasPrefixes: ["receptor", "target model"] },
    { keyPrefix: "partner", labelPrefix: "partner model", descriptor: partner, aliasPrefixes: ["partner", "comparison model"] },
  ], chainsByModel);

  return {
    descriptors: structureDescriptors,
    handles,
    chainHandles: buildChimeraXChainHandles(primary, experimental, predicted, design, scaffold, binder, receptor, chainsByModel),
    selectionHandles: input.namedViews.slice(0, 8).map((viewName) => ({
      label: `view ${viewName}`,
      selector: viewName,
      aliases: [viewName, `named view ${viewName}`],
    })),
  };
}

function addPymolDescriptorChainReferenceHandles(
  handles: Record<string, ReferenceHint>,
  descriptors: Array<{
    keyPrefix: string;
    labelPrefix: string;
    descriptor: SemanticDescriptor | undefined;
    aliasPrefixes: string[];
  }>,
  chainsByObject: Record<string, string[]>,
): void {
  for (const entry of descriptors) {
    const descriptor = entry.descriptor;
    if (!descriptor) {
      continue;
    }

    const chains = uniqueTerms(chainsByObject[descriptor.name] ?? []).slice(0, 4);
    for (const chain of chains) {
      const handleKey = `${entry.keyPrefix}Chain${formatChainHandleSuffix(chain)}`;
      handles[handleKey] = {
        label: `${entry.labelPrefix} chain ${chain}`,
        selector: { object: descriptor.name, chain },
        reason: `${descriptor.name} chain ${chain} is a chain-specific semantic handle for ${entry.labelPrefix}.`,
        aliases: uniqueTerms([
          ...entry.aliasPrefixes.map((alias) => `${alias} chain ${chain}`),
          `${descriptor.name} chain ${chain}`,
        ]),
      };
    }
  }
}

function addChimeraXDescriptorChainReferenceHandles(
  handles: Record<string, ReferenceHint>,
  descriptors: Array<{
    keyPrefix: string;
    labelPrefix: string;
    descriptor: SemanticDescriptor | undefined;
    aliasPrefixes: string[];
  }>,
  chainsByModel: Record<string, string[]>,
): void {
  for (const entry of descriptors) {
    const descriptor = entry.descriptor;
    if (!descriptor) {
      continue;
    }

    const chains = uniqueTerms(chainsByModel[descriptor.key] ?? []).slice(0, 4);
    for (const chain of chains) {
      const handleKey = `${entry.keyPrefix}Chain${formatChainHandleSuffix(chain)}`;
      handles[handleKey] = {
        label: `${entry.labelPrefix} chain ${chain}`,
        selector: { model: descriptor.key, chain },
        reason: `${descriptor.key} ${descriptor.name} chain ${chain} is a chain-specific semantic handle for ${entry.labelPrefix}.`,
        aliases: uniqueTerms([
          ...entry.aliasPrefixes.map((alias) => `${alias} chain ${chain}`),
          `${descriptor.name} chain ${chain}`,
        ]),
      };
    }
  }
}

function formatChainHandleSuffix(chain: string): string {
  const compact = chain.replace(/[^a-zA-Z0-9]/g, "");
  return compact ? compact.toUpperCase() : "Unknown";
}

function classifyStructureName(name: string): string[] {
  const value = name.toLowerCase();
  const separated = value.replace(/[_-]+/g, " ");
  const classifications = new Set<string>();

  if (/(^|[_-])(af|af2|af3)([_-]|$)|alphafold|predicted|prediction|colabfold|esmfold/.test(value)) {
    classifications.add("predicted");
  }
  if (/\b(rosetta|design|designed|variant|mutant|mutation|binder|mpnn|proteinmpnn|hallucinat|rfdiff|rfdiffusion|diffusion|seed|sample|rank|relaxed|unrelaxed)/.test(separated)) {
    classifications.add("design");
  }
  if (/\b(scaffold|backbone|wildtype|wild type|wild|reference|template|parent|start|starting|native|apo|input)\b|(^|[_-])wt([_-]|$)/.test(separated) || /(^|[_-])wt([_-]|$)/.test(value)) {
    classifications.add("scaffold");
  }
  if (/\b(binder|minibinder|nanobody|antibody|fab|peptide|partner)\b/.test(separated)) {
    classifications.add("binder");
  }
  if (/\b(receptor|target|enzyme|complex|assembly|tetramer|dimer|trimer|oligomer|holo|host|cargo)\b/.test(separated)) {
    classifications.add("receptor");
  }
  if (/\b(exp|experimental|crystal|cryo|nmr|xray|x ray|pdb|native|structure)\b/.test(separated) || looksLikePdbCode(value)) {
    classifications.add("experimental");
  }

  return [...classifications];
}

function pickByClassification(descriptors: SemanticDescriptor[], classification: string): SemanticDescriptor | undefined {
  return descriptors.find((descriptor) => descriptor.classifications.includes(classification));
}

function pickExperimentalStructure(descriptors: SemanticDescriptor[], fallback?: SemanticDescriptor): SemanticDescriptor | undefined {
  return pickByClassification(descriptors, "experimental")
    ?? descriptors.find((descriptor) => !descriptor.classifications.includes("predicted"))
    ?? fallback;
}

function pickPrimaryStructure(descriptors: SemanticDescriptor[]): SemanticDescriptor | undefined {
  return pickExperimentalStructure(descriptors)
    ?? pickByClassification(descriptors, "design")
    ?? pickByClassification(descriptors, "predicted")
    ?? descriptors[0];
}

function pickSecondaryStructure(
  descriptors: SemanticDescriptor[],
  primary: SemanticDescriptor | undefined,
  preferred: Array<SemanticDescriptor | undefined>,
): SemanticDescriptor | undefined {
  for (const candidate of preferred) {
    if (candidate && candidate.key !== primary?.key) {
      return candidate;
    }
  }

  return descriptors.find((descriptor) => descriptor.key !== primary?.key);
}

function looksLikePdbCode(value: string): boolean {
  return /(^|[_-])[0-9][a-z0-9]{3}([_-]|$)/.test(value);
}

function createSemanticDescriptor(
  key: string,
  name: string,
  type: string | undefined,
  annotations?: Record<string, SceneAnnotation | undefined>,
): SemanticDescriptor {
  const annotation = findSceneAnnotation(name, annotations) ?? findSceneAnnotation(key, annotations);
  const aliasTerms = annotation?.aliases ?? [];
  const classifications = new Set<string>([
    ...classifyStructureName(name),
    ...(annotation?.classifications ?? []),
    ...aliasTerms.flatMap((alias) => classifyStructureName(alias)),
  ]);

  return {
    key,
    name,
    type,
    classifications: [...classifications],
    aliases: uniqueTerms(aliasTerms),
  };
}

function findSceneAnnotation(
  key: string,
  annotations?: Record<string, SceneAnnotation | undefined>,
): SceneAnnotation | undefined {
  if (!annotations) {
    return undefined;
  }

  const normalized = normalizeLookupKey(key);
  for (const [candidate, value] of Object.entries(annotations)) {
    if (normalizeLookupKey(candidate) === normalized) {
      return value;
    }
  }
  return undefined;
}

function normalizeLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPymolChainHandles(
  primary: SemanticDescriptor | undefined,
  experimental: SemanticDescriptor | undefined,
  predicted: SemanticDescriptor | undefined,
  design: SemanticDescriptor | undefined,
  scaffold: SemanticDescriptor | undefined,
  binder: SemanticDescriptor | undefined,
  receptor: SemanticDescriptor | undefined,
  chainsByObject: Record<string, string[]>,
  visibleChains: string[],
): Array<{ label: string; selector: SelectorValue; aliases?: string[] }> {
  const handles: Array<{ label: string; selector: SelectorValue; aliases?: string[] }> = [];
  const seen = new Set<string>();
  const descriptors = [
    { descriptor: primary, phrases: ["chain"] },
    { descriptor: experimental, phrases: ["experimental model chain", "reference model chain"] },
    { descriptor: predicted, phrases: ["predicted model chain", "alphafold chain"] },
    { descriptor: design, phrases: ["design model chain", "rosetta design chain"] },
    { descriptor: scaffold, phrases: ["scaffold chain", "reference scaffold chain"] },
    { descriptor: binder, phrases: ["binder chain", "partner chain"] },
    { descriptor: receptor, phrases: ["receptor chain", "target chain"] },
  ];

  for (const entry of descriptors) {
    const descriptor = entry.descriptor;
    if (!descriptor) {
      continue;
    }

    const chains = uniqueTerms(chainsByObject[descriptor.name] ?? (descriptor.key === primary?.key ? visibleChains : [])).slice(0, 8);
    for (const chain of chains) {
      const label = descriptor.key === primary?.key ? `chain ${chain}` : `${entry.phrases[0]} ${chain}`;
      const key = `${descriptor.key}:${chain}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      handles.push({
        label,
        selector: { object: descriptor.name, chain },
        aliases: [label, ...entry.phrases.map((phrase) => `${phrase} ${chain}`)],
      });
    }
  }

  return handles.slice(0, 24);
}

function buildChimeraXChainHandles(
  primary: SemanticDescriptor | undefined,
  experimental: SemanticDescriptor | undefined,
  predicted: SemanticDescriptor | undefined,
  design: SemanticDescriptor | undefined,
  scaffold: SemanticDescriptor | undefined,
  binder: SemanticDescriptor | undefined,
  receptor: SemanticDescriptor | undefined,
  chainsByModel: Record<string, string[]>,
): Array<{ label: string; selector: SelectorValue; aliases?: string[] }> {
  const handles: Array<{ label: string; selector: SelectorValue; aliases?: string[] }> = [];
  const seen = new Set<string>();
  const descriptors = [
    { descriptor: primary, phrases: ["chain"] },
    { descriptor: experimental, phrases: ["experimental model chain", "reference model chain"] },
    { descriptor: predicted, phrases: ["predicted model chain", "alphafold chain"] },
    { descriptor: design, phrases: ["design model chain", "rosetta design chain"] },
    { descriptor: scaffold, phrases: ["scaffold chain", "reference scaffold chain"] },
    { descriptor: binder, phrases: ["binder chain", "partner chain"] },
    { descriptor: receptor, phrases: ["receptor chain", "target chain"] },
  ];

  for (const entry of descriptors) {
    const descriptor = entry.descriptor;
    if (!descriptor) {
      continue;
    }

    const chains = uniqueTerms(chainsByModel[descriptor.key] ?? []).slice(0, 8);
    for (const chain of chains) {
      const label = descriptor.key === primary?.key ? `chain ${chain}` : `${entry.phrases[0]} ${chain}`;
      const key = `${descriptor.key}:${chain}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      handles.push({
        label,
        selector: { model: descriptor.key, chain },
        aliases: [label, ...entry.phrases.map((phrase) => `${phrase} ${chain}`)],
      });
    }
  }

  return handles.slice(0, 24);
}

function groupChimeraXChains(chains: Array<{ chain: string }>): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const entry of chains) {
    const match = entry.chain.match(/^(#[^/]+)\/(.+)$/);
    if (!match) {
      continue;
    }
    const modelId = match[1];
    const chainId = match[2];
    grouped[modelId] ??= [];
    grouped[modelId].push(chainId);
  }
  return grouped;
}

function uniqueTerms(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}
