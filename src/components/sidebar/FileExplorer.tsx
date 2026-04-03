import { useState, useEffect, useCallback, useRef } from 'react';
import { listDirectory, getCwd, renameFile } from '../../lib/ipc';
import type { FileEntry } from '../../lib/ipc';
import { useAppStore } from '../../store';

export default function FileExplorer() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [subEntries, setSubEntries] = useState<Map<string, FileEntry[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCwd().then((dir) => setCurrentPath(dir)).catch((e) => setError(String(e)));
  }, []);

  const refreshDirectory = useCallback(() => {
    if (!currentPath) return;
    listDirectory(currentPath).then(setEntries).catch((e) => setError(String(e)));
  }, [currentPath]);

  useEffect(() => {
    refreshDirectory();
  }, [refreshDirectory]);

  const handleClickFile = useCallback((entry: FileEntry) => {
    if (entry.is_dir) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          listDirectory(entry.path).then((subs) => {
            setSubEntries((prev) => new Map(prev).set(entry.path, subs));
          });
        }
        return next;
      });
    } else if (entry.name.endsWith('.ipynb')) {
      const store = useAppStore.getState();
      const existing = store.tabs.find((t) => t.filePath === entry.path);
      if (existing) {
        store.setActiveTab(existing.id);
      } else {
        import('../../lib/ipc').then(({ readNotebook }) => {
          readNotebook(entry.path).then((nb) => {
            store.addTab({ notebook: nb, filePath: entry.path, fileName: entry.name });
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

  const startRename = useCallback((entry: FileEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }

    const dir = renamingPath.replace(/[\\/][^\\/]+$/, '');
    const sep = renamingPath.includes('\\') ? '\\' : '/';
    const newPath = dir + sep + renameValue.trim();

    if (newPath === renamingPath) {
      setRenamingPath(null);
      return;
    }

    try {
      await renameFile(renamingPath, newPath);

      // Update any open tab that references this file
      const store = useAppStore.getState();
      const tab = store.tabs.find((t) => t.filePath === renamingPath);
      if (tab) {
        store.updateTab(tab.id, { filePath: newPath, fileName: renameValue.trim() });
      }

      setRenamingPath(null);
      refreshDirectory();
    } catch (e) {
      setError(`Rename failed: ${e}`);
      setRenamingPath(null);
    }
  }, [renamingPath, renameValue, refreshDirectory]);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp: number): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const currentDirName = currentPath.split(/[\\/]/).pop() ?? currentPath;

  const renderEntry = (entry: FileEntry, depth: number = 0) => {
    const isExpanded = expandedDirs.has(entry.path);
    const isNotebook = entry.name.endsWith('.ipynb');
    const isRenaming = renamingPath === entry.path;
    const indent = depth * 16;

    return (
      <div key={entry.path}>
        <div
          className={`file-entry ${isNotebook ? 'file-entry-notebook' : ''}`}
          style={{ paddingLeft: `${12 + indent}px` }}
          onClick={() => !isRenaming && handleClickFile(entry)}
          onDoubleClick={(e) => startRename(entry, e)}
          title={entry.path}
        >
          <span className="file-entry-icon">
            {entry.is_dir ? (isExpanded ? '📂' : '📁') : (isNotebook ? '📓' : '📄')}
          </span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="file-entry-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') cancelRename();
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="file-entry-name">{entry.name}</span>
          )}
          <span className="file-entry-modified">{formatDate(entry.modified)}</span>
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
        <button className="file-explorer-refresh" onClick={refreshDirectory} title="Refresh">
          &#x21bb;
        </button>
      </div>
      {error && <div className="file-explorer-error">{error}</div>}
      <div className="file-explorer-list">
        {entries.map((entry) => renderEntry(entry))}
      </div>
    </div>
  );
}
