import { Atom, BeakerIcon, Database, FlaskConical, Loader2, Play, Sparkles } from "lucide-react";
import type { TargetKind } from "./types";

export interface WorkflowsPanelRecipe {
  id: string;
  title: string;
  goal: string;
  category: string;
  estimatedMinutes: number;
}

export interface WorkflowsPanelScientificCard {
  id: string;
  title: string;
  summary: string;
  group: "AlphaFold" | "Rosetta";
  intent: string;
  bestRecipeId: string;
  inputHints: string[];
  voiceStarter: string;
}

export interface WorkflowsPanelProps {
  target: TargetKind;
  recipes: WorkflowsPanelRecipe[];
  selectedRecipeId?: string;
  onSelectRecipe: (recipeId: string) => void;
  onLaunchRecipe: (recipeId: string) => void;
  scientificLaunchCards: WorkflowsPanelScientificCard[];
  activeScientificWorkflowId: string | null;
  scientificInputSummary: string;
  scientificInputsPinned: boolean;
  busyRecipeId: string | null;
  launchDisabled?: boolean;
}

export function WorkflowsPanel(props: WorkflowsPanelProps) {
  const {
    target,
    recipes,
    selectedRecipeId,
    onSelectRecipe,
    onLaunchRecipe,
    scientificLaunchCards,
    activeScientificWorkflowId,
    scientificInputSummary,
    scientificInputsPinned,
    busyRecipeId,
    launchDisabled = false,
  } = props;

  const targetLabel = target === "pymol" ? "PyMOL" : "ChimeraX";
  const alphafoldCards = scientificLaunchCards.filter((card) => card.group === "AlphaFold");
  const rosettaCards = scientificLaunchCards.filter((card) => card.group === "Rosetta");

  return (
    <div className="space-y-7">
      <div className="rounded-xl border border-zinc-300/70 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/50 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 dark:bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1">
              Scientific Inputs
            </div>
            <div className={`text-sm ${scientificInputsPinned ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-600 italic"}`}>
              {scientificInputSummary}
            </div>
            {!scientificInputsPinned ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-600 mt-1.5 leading-relaxed">
                Use URL params only for non-sensitive values like <code className="font-mono">?uniprot=</code> or <code className="font-mono">?top_n=</code>. Pass local file paths through the managed agent command instead of the browser URL.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {alphafoldCards.length > 0 || rosettaCards.length > 0 ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
              Scientific Workflows
            </h3>
          </div>

          {alphafoldCards.length > 0 ? (
            <ScientificWorkflowGroup
              label="AlphaFold"
              icon={<Atom className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />}
              cards={alphafoldCards}
              activeId={activeScientificWorkflowId}
              onLaunch={onLaunchRecipe}
              busyRecipeId={busyRecipeId}
              disabled={launchDisabled}
            />
          ) : null}

          {rosettaCards.length > 0 ? (
            <div className={alphafoldCards.length > 0 ? "mt-4" : ""}>
              <ScientificWorkflowGroup
                label="Rosetta"
                icon={<FlaskConical className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />}
                cards={rosettaCards}
                activeId={activeScientificWorkflowId}
                onLaunch={onLaunchRecipe}
                busyRecipeId={busyRecipeId}
                disabled={launchDisabled}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BeakerIcon className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
              {targetLabel} Recipes
            </h3>
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-600 font-mono">
            {recipes.length}
          </span>
        </div>

        {recipes.length === 0 ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-600 italic p-4 rounded-xl border border-dashed border-zinc-300/60 dark:border-zinc-800">
            No recipes registered for {targetLabel}. Check the examples catalog.
          </div>
        ) : (
          <div className="space-y-2">
            {recipes.map((recipe) => {
              const isSelected = selectedRecipeId === recipe.id;
              const isBusy = busyRecipeId === recipe.id;
              return (
                <div
                  key={recipe.id}
                  className={`group rounded-xl border p-3 transition-colors ${
                    isSelected
                      ? "bg-cyan-50/60 dark:bg-cyan-500/10 border-cyan-400/60 dark:border-cyan-500/40"
                      : "bg-zinc-50/80 dark:bg-zinc-900/40 border-zinc-300/60 dark:border-zinc-800 hover:border-zinc-400/70 dark:hover:border-zinc-700"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectRecipe(recipe.id)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
                        {recipe.title}
                      </div>
                      <span className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 dark:text-zinc-500 shrink-0 mt-0.5">
                        {recipe.category}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
                      {recipe.goal}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-1 font-mono">
                      ~{recipe.estimatedMinutes}m
                    </div>
                  </button>
                  <div className="mt-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => onLaunchRecipe(recipe.id)}
                      disabled={launchDisabled || isBusy}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        launchDisabled || isBusy
                          ? "bg-zinc-200/50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
                          : "bg-cyan-500/10 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 dark:hover:bg-cyan-500/30 border border-cyan-400/40 dark:border-cyan-500/40"
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Running
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          Run
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ScientificWorkflowGroup({
  label,
  icon,
  cards,
  activeId,
  onLaunch,
  busyRecipeId,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  cards: WorkflowsPanelScientificCard[];
  activeId: string | null;
  onLaunch: (recipeId: string) => void;
  busyRecipeId: string | null;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="space-y-2">
        {cards.map((card) => {
          const isActive = activeId === card.id;
          const isBusy = busyRecipeId === card.bestRecipeId;
          return (
            <div
              key={card.id}
              className={`rounded-xl border p-3 transition-colors ${
                isActive
                  ? "bg-violet-50/70 dark:bg-violet-500/10 border-violet-400/60 dark:border-violet-500/40"
                  : "bg-zinc-50/80 dark:bg-zinc-900/40 border-zinc-300/60 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
                  {card.title}
                </div>
                {isActive ? (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                    Active
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2 mb-2">
                {card.summary}
              </div>
              {card.inputHints.length > 0 ? (
                <div className="text-[11px] text-zinc-500 dark:text-zinc-600 font-mono mb-2 line-clamp-1">
                  {card.inputHints.join(" · ")}
                </div>
              ) : null}
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => onLaunch(card.bestRecipeId)}
                  disabled={disabled || isBusy}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    disabled || isBusy
                      ? "bg-zinc-200/50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
                      : "bg-violet-500/10 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 dark:hover:bg-violet-500/30 border border-violet-400/40 dark:border-violet-500/40"
                  }`}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Running
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      Launch
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
