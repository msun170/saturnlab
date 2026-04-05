/**
 * Dependency Analyzer for notebook cells.
 *
 * Uses Python's `ast` module (via silent kernel execution) to determine
 * which variables each cell defines (assigns) and uses (reads).
 *
 * Powers:
 *   - 6.3 Stale cell indicators
 *   - 6.4 Execution order warnings
 */

/** Dependency info for a single cell. */
export interface CellDeps {
  defines: string[];  // variables this cell assigns (Name stores, function/class defs)
  uses: string[];     // variables this cell reads (Name loads)
}

/**
 * Python code that analyzes a cell's source and returns JSON with defines/uses.
 * Uses AST walking to find all Name nodes in Store vs Load context.
 * Filters out builtins and common imports.
 */
export function buildAnalysisCode(cellSources: string[]): string {
  const sourcesJson = JSON.stringify(cellSources);
  return `
import ast, json, sys

_BUILTINS = set(dir(__builtins__)) if isinstance(__builtins__, dict) == False else set(__builtins__.keys())
_BUILTINS.update(['print', 'range', 'len', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple',
                  'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'enumerate',
                  'zip', 'map', 'filter', 'sorted', 'reversed', 'any', 'all', 'sum', 'min', 'max',
                  'abs', 'round', 'open', 'input', 'super', 'property', 'classmethod', 'staticmethod',
                  'True', 'False', 'None', '__name__', '__file__', '_', '__'])

def analyze_cell(source):
    defines = set()
    uses = set()
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {"defines": [], "uses": []}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            if isinstance(node.ctx, ast.Store):
                defines.add(node.id)
            elif isinstance(node.ctx, ast.Load):
                if node.id not in _BUILTINS:
                    uses.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defines.add(node.name)
        elif isinstance(node, ast.ClassDef):
            defines.add(node.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                defines.add(alias.asname or alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != '*':
                    defines.add(alias.asname or alias.name)
        elif isinstance(node, ast.For):
            if isinstance(node.target, ast.Name):
                defines.add(node.target.id)
        elif isinstance(node, ast.With):
            for item in node.items:
                if item.optional_vars and isinstance(item.optional_vars, ast.Name):
                    defines.add(item.optional_vars.id)
    # Remove self-defined from uses (cell defines and uses same var)
    uses -= defines
    return {"defines": sorted(defines), "uses": sorted(uses)}

_sources = ${sourcesJson}
_results = [analyze_cell(s) for s in _sources]
print("__SATURN_DEPS__" + json.dumps(_results))
`.trim();
}

/**
 * Parse the dependency analysis result from kernel output.
 * Looks for the __SATURN_DEPS__ prefix in stdout.
 */
export function parseDepsResult(output: string): CellDeps[] | null {
  const prefix = '__SATURN_DEPS__';
  const idx = output.indexOf(prefix);
  if (idx === -1) return null;
  const jsonStr = output.slice(idx + prefix.length).trim();
  try {
    return JSON.parse(jsonStr) as CellDeps[];
  } catch {
    return null;
  }
}

/**
 * Given cell dependencies, determine which cells are "stale".
 *
 * A cell B is stale if it uses a variable defined by cell A where:
 *   1. A has been edited since last run (source !== lastExecutedSource), OR
 *   2. A's last meaningful source change happened after B last ran
 *      (lastSourceChangeAt > B.lastExecutedAt)
 *
 * Re-running a cell without editing does NOT make downstream cells stale.
 * Editing a cell then running it DOES make downstream cells stale (until they re-run).
 * Staleness propagates transitively.
 */
export function findStaleCells(
  cells: {
    deps: CellDeps | null;
    source: string;
    lastExecutedSource: string | null;
    lastExecutedAt: number | null;
    lastSourceChangeAt: number | null;
  }[],
): Set<number> {
  const stale = new Set<number>();

  // Build map: variable -> defining cell index
  const varDefiner = new Map<string, number>();

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell.deps || cell.lastExecutedAt === null) continue;
    for (const v of cell.deps.defines) {
      // Last cell to define this variable wins (by position, not time)
      varDefiner.set(v, i);
    }
  }

  // A defining cell is "dirty" if its source was edited since last execution
  const isDirty = (i: number) => {
    const c = cells[i];
    return c.lastExecutedSource !== null && c.source !== c.lastExecutedSource;
  };

  // Pass 1: mark directly stale cells
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell.deps || cell.lastExecutedAt === null) continue;
    for (const v of cell.deps.uses) {
      const defIdx = varDefiner.get(v);
      if (defIdx === undefined) continue;
      const def = cells[defIdx];

      // Case 1: defining cell was edited but not re-run
      if (isDirty(defIdx)) {
        stale.add(i);
        break;
      }

      // Case 2: defining cell's last meaningful change happened after this cell ran
      if (def.lastSourceChangeAt !== null && cell.lastExecutedAt !== null
          && def.lastSourceChangeAt > cell.lastExecutedAt) {
        stale.add(i);
        break;
      }
    }
  }

  // Pass 2: propagate staleness transitively
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cells.length; i++) {
      if (stale.has(i)) continue;
      const cell = cells[i];
      if (!cell.deps || cell.lastExecutedAt === null) continue;
      for (const v of cell.deps.uses) {
        const defIdx = varDefiner.get(v);
        if (defIdx !== undefined && stale.has(defIdx)) {
          stale.add(i);
          changed = true;
          break;
        }
      }
    }
  }

  return stale;
}

/**
 * Check for execution order warnings.
 * Returns indices of cells that use variables defined BELOW them
 * (in document order), which suggests out-of-order execution.
 */
export function findOutOfOrderCells(
  cells: { deps: CellDeps | null }[],
): Set<number> {
  const warnings = new Set<number>();

  // Build map: variable -> earliest cell index that defines it
  const varDefIndex = new Map<string, number>();
  for (let i = 0; i < cells.length; i++) {
    const deps = cells[i].deps;
    if (!deps) continue;
    for (const v of deps.defines) {
      if (!varDefIndex.has(v)) {
        varDefIndex.set(v, i);
      }
    }
  }

  // Cell uses a variable only defined below it (structural warning)
  for (let i = 0; i < cells.length; i++) {
    const deps = cells[i].deps;
    if (!deps) continue;
    for (const v of deps.uses) {
      const defIdx = varDefIndex.get(v);
      if (defIdx !== undefined && defIdx > i) {
        warnings.add(i);
        break;
      }
    }
  }

  return warnings;
}
