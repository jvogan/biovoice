# BioVoice local agent contract

BioVoice exposes a small JSON command surface for local agents and scripts. It operates a running BioVoice backend and never connects to an arbitrary remote host.

Run commands from the repository root:

```bash
npm run --silent biovoice -- doctor
npm run --silent biovoice -- capabilities
```

Every command writes one JSON value to standard output. Successful responses use `{"ok":true,"command":"...","result":...}`. Failures use `{"ok":false,"error":{"code":"...","message":"..."}}` and a nonzero exit status. Error output does not include a stack trace.

## Commands

### `doctor`

Checks the local backend, Realtime credential presence, viewport privacy policy, and PyMOL and ChimeraX availability.

The HTTP endpoint may respond successfully even when a readiness check is blocked. The CLI therefore returns top-level `"ok": false`, includes the doctor result, and exits nonzero unless every required check is ready.

```bash
npm run --silent biovoice -- doctor
```

### `capabilities`

Returns normalized target readiness, scientific workflows, example recipes, and the supported agent commands. Runtime endpoints and other internal diagnostics are omitted.

```bash
npm run --silent biovoice -- capabilities
```

### `plan`

Validates a scientific request and sends it to the workflow endpoint with `dryRun: true`. It does not mutate PyMOL or ChimeraX, but database-backed inputs may still be downloaded into the local scientific cache so their dimensions and contents can be validated. Use this before a live run when checking inputs or rehearsing automation.

```bash
npm run --silent biovoice -- plan \
  --target pymol \
  --workflow alphafold_vs_experiment_overlay \
  --uniprot P69905 \
  --experimental-pdb-id 4HHB \
  --structure-format pdb
```

### `run`

Runs a schema-validated scientific workflow against the selected target.

```bash
npm run --silent biovoice -- run \
  --target chimerax \
  --workflow alphafold_to_cryo_handoff \
  --uniprot P0DTC2 \
  --emdb-id EMD-11638 \
  --presentation-mode analysis
```

Variant environment reviews accept one to twelve `--mutation` values. Supported forms are `58`, `R58K`, `A:58`, and `A:R58K`. Use the explicit `@` form for insertion codes, for example `A:@100A`; `A:100A` is rejected because it is ambiguous with amino-acid notation.

```bash
npm run --silent biovoice -- run \
  --target pymol \
  --workflow variant_environment_review \
  --uniprot P69905 \
  --mutation A:H58Y \
  --ligand HEM \
  --neighborhood-angstroms 5
```

Rosetta workflows can take repeated candidate paths:

```bash
npm run --silent biovoice -- plan \
  --target pymol \
  --workflow rosetta_top_design_compare \
  --model examples/data/local/rosetta_demo/reference_scaffold.pdb \
  --scorefile examples/data/local/rosetta_demo/score.sc \
  --candidate examples/data/local/rosetta_demo/design_top_a.pdb \
  --candidate examples/data/local/rosetta_demo/design_top_b.pdb \
  --top-n 2
```

### `state`

Returns the current target state and semantic references such as `wholeComplex`, `predictedModel`, `binderModel`, and `map`.

```bash
npm run --silent biovoice -- state --target pymol
```

### `capture`

Captures the current viewport locally. The command always sends `attachToConversation: false`.

```bash
npm run --silent biovoice -- capture --target chimerax
```

### `undo`

Restores the target checkpoint created before the most recent action bundle.

```bash
npm run --silent biovoice -- undo --target pymol
```

### `receipts`

Lists recent local run receipts. The limit defaults to 20 and can range from 1 to 100.

Receipts stay on the local machine. Runtime housekeeping removes receipts older than 24 hours by default (`RUNTIME_RECEIPT_RETENTION_HOURS=24`, `RUNTIME_RECEIPT_KEEP_LATEST=0`) during managed startup or `npm run cleanup:runtime`.

```bash
npm run --silent biovoice -- receipts --limit 10
```

## Scientific input flags

The workflow schema remains the source of truth. The CLI maps these bounded flags to that schema:

| Flag | Use |
| --- | --- |
| `--target pymol\|chimerax` | Required target application |
| `--workflow ID` | Required workflow identifier |
| `--presentation-mode analysis\|demo\|publication` | Presentation intent; defaults to `analysis` |
| `--uniprot ID` | AlphaFold DB or variant-review model intake |
| `--experimental-pdb-id ID` | RCSB structure for an AlphaFold overlay |
| `--emdb-id ID` | EMDB map for a cryo handoff |
| `--structure-format pdb\|cif` | Database structure format |
| `--pdb-format pdb\|cif` | Experimental RCSB structure format |
| `--model PATH` | Local AlphaFold model, Rosetta reference, or variant-review model |
| `--experimental PATH` | Local experimental structure |
| `--pae PATH` | Local PAE JSON containing a `predicted_aligned_error` or `pae` matrix |
| `--map PATH` | Local cryo-EM map |
| `--bundle PATH` | Rosetta candidate bundle |
| `--scorefile PATH` | Rosetta scorefile |
| `--candidate PATH` | Rosetta candidate; repeatable up to 24 times |
| `--top-n 1..8` | Rosetta comparison count |
| `--interface-chains A,B` | Two chain identifiers |
| `--focus-residue TOKEN` | Focus residue; repeatable up to 64 times |
| `--mutation TOKEN` | Variant site; repeatable up to 12 times |
| `--comparison PATH` | Optional variant comparison structure |
| `--ligand CODE` | Ligand code for Rosetta or variant context |
| `--neighborhood-angstroms 2..12` | Variant neighborhood radius |

Flags that do not apply to the selected workflow family are rejected instead of being ignored. Local path flags reject URL syntax. The CLI does not expose arbitrary downloads or raw PyMOL and ChimeraX commands.

## Local server selection

The default backend is `http://127.0.0.1:3000`. A different local port can be selected with `--base-url`:

```bash
npm run --silent biovoice -- doctor --base-url http://localhost:3100
```

Only `localhost`, IPv4 loopback addresses, and `::1` are accepted. Credentials, URL paths, query strings, and fragments are rejected.

## Voice contract fixture

The repository includes a text-only structural-biology fixture covering target selection, all scientific workflows, database identifiers, entity corrections, ambiguous requests, reversible scene edits, and confirmation-required actions.

```bash
npm run verify:voice-evals
```

The validator checks the fixture locally. It does not use audio, call a model, or contact a network service.
