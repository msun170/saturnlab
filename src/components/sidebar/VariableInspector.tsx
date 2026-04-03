import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../store';
import { inspectVariables, executeCode } from '../../lib/ipc';
import type { KernelOutput } from '../../types/kernel';
import type { VariableInfo } from '../../types/memory';
import { formatBytes } from '../../types/memory';

type SortKey = 'name' | 'type' | 'size';

export default function VariableInspector() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);

  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(false);
  const pendingMsgId = useRef<string | null>(null);

  // Listen for __SATURN_VARS__ responses on iopub
  useEffect(() => {
    const unlisten = listen<KernelOutput>('kernel-output', (event) => {
      const { msg_type, content } = event.payload;
      if (msg_type !== 'stream') return;

      const text = (content.text as string) ?? '';
      if (!text.includes('__SATURN_VARS__')) return;

      // Extract JSON after the prefix
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
      } catch {
        // JSON parse failed, ignore
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const refresh = useCallback(async () => {
    if (!tab?.kernelId) return;
    setLoading(true);
    try {
      const msgId = crypto.randomUUID();
      pendingMsgId.current = msgId;
      await inspectVariables(tab.kernelId, msgId);
    } catch {
      setLoading(false);
    }
  }, [tab?.kernelId]);

  // Auto-refresh when tab changes or kernel starts
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
    // Use a temporary pending entry so the output doesn't show in the notebook
    await executeCode(tab.kernelId, `del ${varName}; import gc; gc.collect()`, true, msgId);
    // Refresh after deletion
    setTimeout(refresh, 500);
  }, [tab?.kernelId, refresh]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(key === 'name'); // name ascending, size/type descending by default
    }
  };

  const sorted = [...variables].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortBy === 'type') cmp = a.type.localeCompare(b.type);
    else if (sortBy === 'size') cmp = a.size - b.size;
    return sortAsc ? cmp : -cmp;
  });

  if (!tab?.kernelId) {
    return <div className="var-inspector-empty">No kernel connected</div>;
  }

  return (
    <div className="var-inspector">
      <div className="var-inspector-header">
        <span>Variables</span>
        <button
          className="var-inspector-refresh"
          onClick={refresh}
          disabled={loading}
          title="Refresh"
        >
          {loading ? '...' : '\u21bb'}
        </button>
      </div>

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
              {sorted.map((v) => (
                <tr key={v.name}>
                  <td className="var-name">{v.name}</td>
                  <td className="var-type">{v.type}</td>
                  <td className="var-size">{formatBytes(v.size)}</td>
                  <td className="var-shape">{v.shape}</td>
                  <td>
                    <button
                      className="var-delete"
                      onClick={() => handleDelete(v.name)}
                      title={`Delete ${v.name}`}
                    >
                      x
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
