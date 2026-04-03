import { useState, useEffect, useCallback } from 'react';
import { listDirectory, getCwd } from '../../lib/ipc';
import type { FileEntry } from '../../lib/ipc';
import { useAppStore } from '../../store';

export default function FileExplorer() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [subEntries, setSubEntries] = useState<Map<string, FileEntry[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Get initial working directory
  useEffect(() => {
    getCwd().then((dir) => {
      setCurrentPath(dir);
    }).catch((e) => setError(String(e)));
  }, []);

  // Load directory contents when path changes
  useEffect(() => {
    if (!currentPath) return;
    listDirectory(currentPath)
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, [currentPath]);

  const handleClickFile = useCallback((entry: FileEntry) => {
    if (entry.is_dir) {
      // Toggle directory expansion
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          // Load subdirectory contents
          listDirectory(entry.path).then((subs) => {
            setSubEntries((prev) => new Map(prev).set(entry.path, subs));
          });
        }
        return next;
      });
    } else if (entry.name.endsWith('.ipynb')) {
      // Open notebook in a tab
      const store = useAppStore.getState();
      const existing = store.tabs.find((t) => t.filePath === entry.path);
      if (existing) {
        store.setActiveTab(existing.id);
      } else {
        import('../../lib/ipc').then(({ readNotebook }) => {
          readNotebook(entry.path).then((nb) => {
            const fileName = entry.name;
            store.addTab({ notebook: nb, filePath: entry.path, fileName });
          });
        });
      }
    }
  }, []);

  const navigateUp = useCallback(() => {
    const parent = currentPath.replace(/[\\/][^\\/]+$/, '');
    if (parent && parent !== currentPath) {
      setCurrentPath(parent);
      setExpandedDirs(new Set());
      setSubEntries(new Map());
    }
  }, [currentPath]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const currentDirName = currentPath.split(/[\\/]/).pop() ?? currentPath;

  const renderEntry = (entry: FileEntry, depth: number = 0) => {
    const isExpanded = expandedDirs.has(entry.path);
    const isNotebook = entry.name.endsWith('.ipynb');
    const indent = depth * 16;

    return (
      <div key={entry.path}>
        <div
          className={`file-entry ${isNotebook ? 'file-entry-notebook' : ''}`}
          style={{ paddingLeft: `${12 + indent}px` }}
          onClick={() => handleClickFile(entry)}
          title={entry.path}
        >
          <span className="file-entry-icon">
            {entry.is_dir ? (isExpanded ? '📂' : '📁') : (isNotebook ? '📓' : '📄')}
          </span>
          <span className="file-entry-name">{entry.name}</span>
          {!entry.is_dir && (
            <span className="file-entry-size">{formatSize(entry.size)}</span>
          )}
        </div>
        {entry.is_dir && isExpanded && subEntries.get(entry.path)?.map((sub) =>
          renderEntry(sub, depth + 1)
        )}
      </div>
    );
  };

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <button className="file-explorer-up" onClick={navigateUp} title="Go up">
          ..
        </button>
        <span className="file-explorer-path" title={currentPath}>
          {currentDirName}
        </span>
      </div>
      {error && <div className="file-explorer-error">{error}</div>}
      <div className="file-explorer-list">
        {entries.map((entry) => renderEntry(entry))}
      </div>
    </div>
  );
}
