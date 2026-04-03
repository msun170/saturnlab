import { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../store';
import { inspectVariables, executeCode } from '../../lib/ipc';
import type { KernelOutput } from '../../types/kernel';
import type { VariableInfo } from '../../types/memory';
import { formatBytes } from '../../types/memory';

type SortKey = 'name' | 'type' | 'size';

// ─── Category helpers ────────────────────────────────────────────────

interface CategoryInfo {
  name: string;
  color: string;
  totalSize: number;
  count: number;
}

function categorizeVariable(v: VariableInfo): string {
  const t = v.type.toLowerCase();
  if (t === 'dataframe' || t === 'series') return 'DataFrames';
  if (t === 'ndarray' || t === 'tensor') return 'Arrays/Tensors';
  if (t === 'str') return 'Strings';
  if (t === 'module') return 'Modules';
  return 'Other';
}

const CATEGORY_COLORS: Record<string, string> = {
  'DataFrames': '#2196f3',
  'Arrays/Tensors': '#ff9800',
  'Strings': '#4caf50',
  'Modules': '#9e9e9e',
  'Other': '#ab47bc',
};

// ─── Duplicate detection ─────────────────────────────────────────────

interface DuplicateGroup {
  variables: VariableInfo[];
  reason: string;
}

function findDuplicates(vars: VariableInfo[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  // Check for same id (same underlying object)
  const byId = new Map<number, VariableInfo[]>();
  for (const v of vars) {
    if (v.id === 0 || v.size < 1024) continue; // skip tiny/unknown
    const existing = byId.get(v.id) ?? [];
    existing.push(v);
    byId.set(v.id, existing);
  }
  for (const [, group] of byId) {
    if (group.length > 1) {
      groups.push({ variables: group, reason: 'Same object in memory' });
    }
  }

  // Check for same shape + type + similar size (but different id)
  const seenIds = new Set(groups.flatMap((g) => g.variables.map((v) => v.name)));
  const candidates = vars.filter(
    (v) => v.size > 10000 && !seenIds.has(v.name) && v.shape,
  );
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (
        a.type === b.type &&
        a.shape === b.shape &&
        Math.abs(a.size - b.size) / Math.max(a.size, b.size) < 0.1
      ) {
        groups.push({
          variables: [a, b],
          reason: `Same type/shape (${a.type} ${a.shape})`,
        });
      }
    }
  }

  return groups;
}

// ─── Component ───────────────────────────────────────────────────────

export default function VariableInspector() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);

  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<VariableInfo[] | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<string[][]>([]);

  // Listen for __SATURN_VARS__ responses
  useEffect(() => {
    const unlisten = listen<KernelOutput>('kernel-output', (event) => {
      const { msg_type, content } = event.payload;
      if (msg_type !== 'stream') return;
      const text = (content.text as string) ?? '';
      if (!text.includes('__SATURN_VARS__')) return;

      const jsonStr = text.split('__SATURN_VARS__')[1]?.trim();
      if (!jsonStr) return;

      try {
        const varsObj = JSON.parse(jsonStr) as Record<string, Omit<VariableInfo, 'name'>>;
        const varList: VariableInfo[] = Object.entries(varsObj).map(([name, info]) => ({
          name,
          ...info,
        }));
        setVariables(varList);
        setLoading(false);
      } catch { /* ignore */ }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Track variable references per execution (for unused detection)
  useEffect(() => {
    const unlisten = listen<KernelOutput>('kernel-output', (event) => {
      if (event.payload.msg_type !== 'execute_input') return;
      const code = (event.payload.content.code as string) ?? '';
      if (code.includes('__SATURN_VARS__')) return; // skip our own introspection
      // Extract variable names referenced in the code (simple regex)
      const refs = Array.from(code.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)).map((m) => m[1]);
      setExecutionHistory((prev) => [...prev.slice(-50), refs]); // keep last 50
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const refresh = useCallback(async () => {
    if (!tab?.kernelId) return;
    setLoading(true);
    try {
      const msgId = crypto.randomUUID();
      await inspectVariables(tab.kernelId, msgId);
    } catch { setLoading(false); }
  }, [tab?.kernelId]);

  useEffect(() => {
    if (tab?.kernelId && tab?.kernelStatus === 'idle') {
      refresh();
    } else {
      setVariables([]);
    }
  }, [tab?.kernelId, tab?.kernelStatus]);

  const handleDelete = useCallback(async (varName: string) => {
    if (!tab?.kernelId) return;
    const msgId = crypto.randomUUID();
    await executeCode(tab.kernelId, `del ${varName}; import gc; gc.collect()`, true, msgId);
    setTimeout(refresh, 500);
  }, [tab?.kernelId, refresh]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(key === 'name'); }
  };

  // ─── Derived data ──────────────────────────────────────────────

  const sorted = [...variables].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortBy === 'type') cmp = a.type.localeCompare(b.type);
    else if (sortBy === 'size') cmp = a.size - b.size;
    return sortAsc ? cmp : -cmp;
  });

  // 2.2: Category breakdown
  const categories = useMemo((): CategoryInfo[] => {
    const map = new Map<string, CategoryInfo>();
    for (const v of variables) {
      if (v.size <= 0) continue;
      const cat = categorizeVariable(v);
      const existing = map.get(cat) ?? { name: cat, color: CATEGORY_COLORS[cat] ?? '#999', totalSize: 0, count: 0 };
      existing.totalSize += v.size;
      existing.count++;
      map.set(cat, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.totalSize - a.totalSize);
  }, [variables]);

  const totalSize = categories.reduce((s, c) => s + c.totalSize, 0);

  // 2.5: Duplicates
  const duplicates = useMemo(() => findDuplicates(variables), [variables]);

  // 2.6: Unused variable suggestions
  const unusedVars = useMemo(() => {
    if (executionHistory.length < 3) return [];
    const recentRefs = new Set(executionHistory.slice(-10).flat());
    return variables
      .filter((v) => v.size > 10000 && !recentRefs.has(v.name))
      .sort((a, b) => b.size - a.size);
  }, [variables, executionHistory]);

  // 2.7: Snapshot diff
  const snapshotDiff = useMemo(() => {
    if (!snapshot) return null;
    const snapMap = new Map(snapshot.map((v) => [v.name, v]));
    const currentMap = new Map(variables.map((v) => [v.name, v]));

    const newVars = variables.filter((v) => !snapMap.has(v.name) && v.size > 100);
    const gone = snapshot.filter((v) => !currentMap.has(v.name) && v.size > 100);
    const grew = variables.filter((v) => {
      const old = snapMap.get(v.name);
      return old && v.size > old.size * 1.1 && v.size - old.size > 1000;
    }).map((v) => ({ ...v, delta: v.size - (snapMap.get(v.name)?.size ?? 0) }));

    const totalBefore = snapshot.reduce((s, v) => s + Math.max(v.size, 0), 0);
    const totalAfter = variables.reduce((s, v) => s + Math.max(v.size, 0), 0);

    return { newVars, gone, grew, totalDelta: totalAfter - totalBefore };
  }, [snapshot, variables]);

  // ─── Render ────────────────────────────────────────────────────

  if (!tab?.kernelId) {
    return <div className="var-inspector-empty">No kernel connected</div>;
  }

  return (
    <div className="var-inspector">
      <div className="var-inspector-header">
        <span>Variables</span>
        <div className="var-inspector-actions">
          <button onClick={() => setSnapshot(variables)} title="Take snapshot" className="var-inspector-btn">
            Snap
          </button>
          <button
            onClick={() => setShowDuplicates(!showDuplicates)}
            title="Toggle duplicate warnings"
            className={`var-inspector-btn ${duplicates.length > 0 ? 'var-has-warnings' : ''}`}
          >
            {duplicates.length > 0 ? `! ${duplicates.length}` : '!'}
          </button>
          <button onClick={refresh} disabled={loading} title="Refresh" className="var-inspector-btn">
            {loading ? '...' : '\u21bb'}
          </button>
        </div>
      </div>

      {/* 2.2: Category breakdown bar */}
      {categories.length > 0 && (
        <div className="var-categories">
          <div className="var-category-bar">
            {categories.map((cat) => (
              <div
                key={cat.name}
                className="var-category-segment"
                style={{
                  width: `${(cat.totalSize / totalSize) * 100}%`,
                  backgroundColor: cat.color,
                }}
                title={`${cat.name}: ${formatBytes(cat.totalSize)} (${cat.count} vars)`}
              />
            ))}
          </div>
          <div className="var-category-legend">
            {categories.map((cat) => (
              <span key={cat.name} className="var-category-label">
                <span className="var-category-dot" style={{ backgroundColor: cat.color }} />
                {cat.name} ({formatBytes(cat.totalSize)})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 2.5: Duplicate warnings */}
      {showDuplicates && duplicates.length > 0 && (
        <div className="var-duplicates">
          {duplicates.map((group, i) => (
            <div key={i} className="var-duplicate-item">
              <span className="var-duplicate-icon">!</span>
              <span>
                <strong>{group.variables.map((v) => v.name).join(', ')}</strong>
                <br />
                <small>{group.reason}</small>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 2.7: Snapshot diff */}
      {snapshotDiff && (
        <div className="var-snapshot-diff">
          <div className="var-snapshot-header">
            Since snapshot:
            <span className={snapshotDiff.totalDelta >= 0 ? 'var-delta-up' : 'var-delta-down'}>
              {snapshotDiff.totalDelta >= 0 ? '+' : ''}{formatBytes(Math.abs(snapshotDiff.totalDelta))}
            </span>
            <button onClick={() => setSnapshot(null)} className="var-inspector-btn" title="Clear snapshot">x</button>
          </div>
          {snapshotDiff.newVars.length > 0 && (
            <div className="var-snapshot-section">New: {snapshotDiff.newVars.map((v) => v.name).join(', ')}</div>
          )}
          {snapshotDiff.gone.length > 0 && (
            <div className="var-snapshot-section">Gone: {snapshotDiff.gone.map((v) => v.name).join(', ')}</div>
          )}
          {snapshotDiff.grew.length > 0 && (
            <div className="var-snapshot-section">
              Grew: {snapshotDiff.grew.map((v) => `${v.name} (+${formatBytes(v.delta)})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Variable table */}
      {variables.length === 0 ? (
        <div className="var-inspector-empty">
          {loading ? 'Loading...' : 'No variables defined'}
        </div>
      ) : (
        <div className="var-inspector-table-container">
          <table className="var-inspector-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} className="var-th-sortable">
                  Name {sortBy === 'name' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
                </th>
                <th onClick={() => handleSort('type')} className="var-th-sortable">
                  Type {sortBy === 'type' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
                </th>
                <th onClick={() => handleSort('size')} className="var-th-sortable">
                  Size {sortBy === 'size' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
                </th>
                <th>Shape</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => {
                const isUnused = unusedVars.some((u) => u.name === v.name);
                return (
                  <tr key={v.name} className={isUnused ? 'var-row-unused' : ''}>
                    <td className="var-name">
                      {v.name}
                      {isUnused && <span className="var-unused-badge" title="Not used recently">idle</span>}
                    </td>
                    <td className="var-type">{v.type}</td>
                    <td className="var-size">{formatBytes(v.size)}</td>
                    <td className="var-shape">{v.shape}</td>
                    <td>
                      <button className="var-delete" onClick={() => handleDelete(v.name)} title={`Delete ${v.name}`}>
                        x
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
