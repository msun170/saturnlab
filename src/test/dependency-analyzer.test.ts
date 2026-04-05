import { describe, it, expect } from 'vitest';
import { parseDepsResult, findStaleCells, findOutOfOrderCells, type CellDeps } from '../lib/dependencyAnalyzer';

describe('parseDepsResult', () => {
  it('parses valid __SATURN_DEPS__ output', () => {
    const output = '__SATURN_DEPS__[{"defines":["x","y"],"uses":["pd"]},{"defines":["z"],"uses":["x","y"]}]';
    const result = parseDepsResult(output);
    expect(result).toEqual([
      { defines: ['x', 'y'], uses: ['pd'] },
      { defines: ['z'], uses: ['x', 'y'] },
    ]);
  });

  it('returns null for missing prefix', () => {
    expect(parseDepsResult('some random output')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseDepsResult('__SATURN_DEPS__not json')).toBeNull();
  });

  it('handles prefix with preceding output', () => {
    const output = 'some stuff\n__SATURN_DEPS__[{"defines":["a"],"uses":[]}]';
    const result = parseDepsResult(output);
    expect(result).toEqual([{ defines: ['a'], uses: [] }]);
  });
});

// Helper to build cell data for findStaleCells
function cell(opts: {
  defines?: string[];
  uses?: string[];
  source: string;
  lastExecutedSource: string | null;
  lastExecutedAt: number | null;
  lastSourceChangeAt?: number | null;
}) {
  return {
    deps: { defines: opts.defines ?? [], uses: opts.uses ?? [] } as CellDeps,
    source: opts.source,
    lastExecutedSource: opts.lastExecutedSource,
    lastExecutedAt: opts.lastExecutedAt,
    lastSourceChangeAt: opts.lastSourceChangeAt ?? null,
  };
}

describe('findStaleCells', () => {
  it('does NOT mark stale when cell re-run without editing', () => {
    // Cell 0 run at t=100, re-run at t=300 with SAME source. No source change.
    // Cell 1 run at t=200. Should NOT be stale.
    const cells = [
      cell({ defines: ['x'], source: 'x = 10', lastExecutedSource: 'x = 10', lastExecutedAt: 300, lastSourceChangeAt: null }),
      cell({ uses: ['x'], source: 'y = x * 2', lastExecutedSource: 'y = x * 2', lastExecutedAt: 200 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.size).toBe(0);
  });

  it('marks stale when cell edited but not re-run', () => {
    // Cell 0 was run with "x=10" but now source is "x=99" (dirty)
    const cells = [
      cell({ defines: ['x'], source: 'x = 99', lastExecutedSource: 'x = 10', lastExecutedAt: 100 }),
      cell({ uses: ['x'], source: 'y = x * 2', lastExecutedSource: 'y = x * 2', lastExecutedAt: 200 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.has(1)).toBe(true);
  });

  it('marks stale when cell edited AND re-run, downstream not yet run', () => {
    // Cell 0 edited and run at t=300 (sourceChangeAt=300). Cell 1 last ran at t=200.
    const cells = [
      cell({ defines: ['x'], source: 'x = 20', lastExecutedSource: 'x = 20', lastExecutedAt: 300, lastSourceChangeAt: 300 }),
      cell({ uses: ['x'], source: 'y = x * 2', lastExecutedSource: 'y = x * 2', lastExecutedAt: 200 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.has(1)).toBe(true);
  });

  it('clears stale after downstream cell re-runs', () => {
    // Cell 0 changed at t=300. Cell 1 re-ran at t=400.
    const cells = [
      cell({ defines: ['x'], source: 'x = 20', lastExecutedSource: 'x = 20', lastExecutedAt: 300, lastSourceChangeAt: 300 }),
      cell({ uses: ['x'], source: 'y = x * 2', lastExecutedSource: 'y = x * 2', lastExecutedAt: 400 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.size).toBe(0);
  });

  it('no stale cells when executed in order, no edits', () => {
    const cells = [
      cell({ defines: ['x'], source: 'x = 10', lastExecutedSource: 'x = 10', lastExecutedAt: 100 }),
      cell({ uses: ['x'], source: 'y = x', lastExecutedSource: 'y = x', lastExecutedAt: 200 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.size).toBe(0);
  });

  it('propagates staleness transitively', () => {
    // Cell 0 edited (dirty). Cell 1 uses x -> stale. Cell 2 uses y -> transitively stale.
    const cells = [
      cell({ defines: ['x'], source: 'x = 99', lastExecutedSource: 'x = 10', lastExecutedAt: 100 }),
      cell({ defines: ['y'], uses: ['x'], source: 'y = x', lastExecutedSource: 'y = x', lastExecutedAt: 200 }),
      cell({ uses: ['y'], source: 'z = y', lastExecutedSource: 'z = y', lastExecutedAt: 300 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.has(0)).toBe(false);
    expect(stale.has(1)).toBe(true);
    expect(stale.has(2)).toBe(true);
  });

  it('handles cells with no deps', () => {
    const cells = [
      { deps: null, source: '', lastExecutedSource: null, lastExecutedAt: null, lastSourceChangeAt: null },
      cell({ uses: ['x'], source: 'y = x', lastExecutedSource: 'y = x', lastExecutedAt: 200 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.size).toBe(0);
  });

  it('handles never-executed cells', () => {
    const cells = [
      cell({ defines: ['x'], source: 'x = 10', lastExecutedSource: null, lastExecutedAt: null }),
      cell({ uses: ['x'], source: 'y = x', lastExecutedSource: 'y = x', lastExecutedAt: 200 }),
    ];
    const stale = findStaleCells(cells);
    expect(stale.size).toBe(0);
  });
});

describe('findOutOfOrderCells', () => {
  it('flags cell that uses variable defined below it', () => {
    const cells = [
      { deps: { defines: [], uses: ['x'] } as CellDeps },
      { deps: { defines: ['x'], uses: [] } as CellDeps },
    ];
    const warnings = findOutOfOrderCells(cells);
    expect(warnings.has(0)).toBe(true);
    expect(warnings.has(1)).toBe(false);
  });

  it('no warnings when variables flow top-to-bottom', () => {
    const cells = [
      { deps: { defines: ['x'], uses: [] } as CellDeps },
      { deps: { defines: ['y'], uses: ['x'] } as CellDeps },
    ];
    const warnings = findOutOfOrderCells(cells);
    expect(warnings.size).toBe(0);
  });

  it('handles null deps gracefully', () => {
    const cells = [
      { deps: null },
      { deps: { defines: ['x'], uses: [] } as CellDeps },
    ];
    const warnings = findOutOfOrderCells(cells);
    expect(warnings.size).toBe(0);
  });
});
