import { useState, useEffect, useCallback, useRef } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import Notebook from './components/notebook/Notebook';
import type { NotebookHandle } from './components/notebook/Notebook';
import Launcher from './components/tabs/Launcher';
import SuspendedPlaceholder from './components/tabs/SuspendedPlaceholder';
import MenuBar from './components/toolbar/MenuBar';
import TabBar from './components/tabs/TabBar';
import Sidebar from './components/sidebar/Sidebar';
import StatusBar from './components/statusbar/StatusBar';
import ShortcutsModal from './components/toolbar/ShortcutsModal';
import { useSuspension } from './hooks/useSuspension';
import { useAppStore } from './store';
import { listKernelspecs, startKernel, stopKernel, readNotebook, writeNotebook } from './lib/ipc';
import './App.css';

function App() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const kernelspecs = useAppStore((s) => s.kernelspecs);
  const error = useAppStore((s) => s.error);
  const showShortcuts = useAppStore((s) => s.showShortcuts);
  const notebookRef = useRef<NotebookHandle>(null);

  // Initialize suspension timer system
  useSuspension();

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('saturn-sidebar-width');
    return saved ? parseInt(saved, 10) : 240;
  });

  const handleSidebarResize = useCallback((width: number) => {
    setSidebarWidth(width);
    localStorage.setItem('saturn-sidebar-width', String(width));
  }, []);

  const tab = tabs.find((t) => t.id === activeTabId);

  // Use getState() for actions to avoid re-render loops
  const actions = useRef(useAppStore.getState());
  const addTab = actions.current.addTab;
  const setActiveTab = actions.current.setActiveTab;
  const setKernelspecs = actions.current.setKernelspecs;
  const setError = actions.current.setError;
  const setShowShortcuts = actions.current.setShowShortcuts;

  // Discover kernelspecs on mount (retry once if empty, IPC might not be ready)
  useEffect(() => {
    const fetchSpecs = () => {
      listKernelspecs()
        .then((specs) => {
          setKernelspecs(specs);
          if (specs.length === 0) {
            setTimeout(() => {
              listKernelspecs().then((retry) => {
                if (retry.length > 0) setKernelspecs(retry);
              }).catch(() => {});
            }, 2000);
          }
        })
        .catch((e: unknown) => setError(`Failed to discover kernels: ${e}`));
    };
    fetchSpecs();
  }, []);

  // ─── Helpers ───────────────────────────────────────────────────

  const updateActiveTab = useCallback(
    (patch: Partial<import('./store/tabStore').TabState>) => {
      const state = useAppStore.getState();
      const activeId = state.activeTabId;
      if (activeId) state.updateTab(activeId, patch);
    },
    [],
  );

  // ─── Kernel Lifecycle ──────────────────────────────────────────

  const handleStartKernel = useCallback(async (specName: string) => {
    if (!tab) return;
    setError(null);
    updateActiveTab({ kernelStatus: 'starting' });
    try {
      const id = await startKernel(specName);
      updateActiveTab({ kernelId: id, kernelStatus: 'idle' });
    } catch (e: unknown) {
      setError(`Failed to start kernel: ${e}`);
      updateActiveTab({ kernelStatus: 'disconnected' });
    }
  }, [tab?.id, updateActiveTab]);

  const handleStopKernel = useCallback(async () => {
    if (!tab?.kernelId) return;
    try {
      await stopKernel(tab.kernelId);
      updateActiveTab({ kernelId: null, kernelStatus: 'disconnected' });
    } catch (e: unknown) {
      setError(`Failed to stop kernel: ${e}`);
    }
  }, [tab?.id, tab?.kernelId, updateActiveTab]);

  // ─── File Operations ───────────────────────────────────────────

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
      });
      if (!selected) return;

      const path = typeof selected === 'string' ? selected : (selected as unknown as { path: string }).path;
      if (!path) return;

      const nb = await readNotebook(path);
      const fileName = path.split(/[\\/]/).pop() ?? 'Untitled.ipynb';
      setError(null);

      // Check if this file is already open in a tab
      const existing = tabs.find((t) => t.filePath === path);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      // If current tab is empty and untouched, reuse it
      if (tab && !tab.filePath && !tab.isDirty && !tab.kernelId) {
        updateActiveTab({ notebook: nb, filePath: path, fileName });
      } else {
        // Open in a new tab
        addTab({ notebook: nb, filePath: path, fileName });
      }

      // Auto-start kernel
      const specs = kernelspecs;
      if (nb.metadata.kernelspec && specs.length > 0) {
        const specName = nb.metadata.kernelspec.name;
        if (specs.find((s) => s.name === specName)) {
          // Need to wait for state to settle, then start kernel
          setTimeout(() => handleStartKernel(specName), 100);
        }
      }
    } catch (e: unknown) {
      setError(`Failed to open file: ${e}`);
    }
  }, [tab?.id, tab?.filePath, tab?.isDirty, tab?.kernelId, kernelspecs, handleStartKernel, updateActiveTab]);

  const handleSaveFile = useCallback(async () => {
    if (!tab) return;
    try {
      let path = tab.filePath;
      if (!path) {
        const selected = await save({
          filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
          defaultPath: 'Untitled.ipynb',
        });
        if (!selected) return;
        path = selected;
        const fileName = path.split(/[\\/]/).pop() ?? 'Untitled.ipynb';
        updateActiveTab({ filePath: path, fileName });
      }
      await writeNotebook(path, tab.notebook);
      updateActiveTab({ isDirty: false });
    } catch (e: unknown) {
      setError(`Failed to save file: ${e}`);
    }
  }, [tab?.id, tab?.filePath, tab?.notebook, updateActiveTab]);

  const handleSaveAs = useCallback(async () => {
    if (!tab) return;
    try {
      const selected = await save({
        filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
        defaultPath: 'Untitled.ipynb',
      });
      if (!selected) return;
      const fileName = selected.split(/[\\/]/).pop() ?? 'Untitled.ipynb';
      updateActiveTab({ filePath: selected, fileName });
      await writeNotebook(selected, tab.notebook);
      updateActiveTab({ isDirty: false });
    } catch (e: unknown) {
      setError(`Failed to save: ${e}`);
    }
  }, [tab?.id, tab?.notebook, updateActiveTab]);

  const handleNewNotebook = useCallback(() => {
    addTab({ fileName: 'Launcher', isLauncher: true });
  }, []);

  const handleRestartKernel = useCallback(async () => {
    if (!tab?.kernelId) return;
    const specName = kernelspecs.length > 0 ? kernelspecs[0].name : null;
    await handleStopKernel();
    if (specName) {
      await handleStartKernel(specName);
    }
  }, [tab?.kernelId, kernelspecs, handleStopKernel, handleStartKernel]);

  // ─── Keyboard Shortcuts ────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleOpenFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenFile, handleSaveFile]);

  // ─── Render ────────────────────────────────────────────────────

  if (!tab) return null;

  return (
    <div className="app">
      <MenuBar
        onOpen={handleOpenFile}
        onSave={handleSaveFile}
        onSaveAs={handleSaveAs}
        onNewNotebook={handleNewNotebook}
        onCloseTab={() => {
          if (tab?.kernelId) {
            import('./lib/ipc').then(({ stopKernel }) => stopKernel(tab.kernelId!));
          }
          if (tab) useAppStore.getState().removeTab(tab.id);
        }}
        onDownloadPy={() => {/* TODO */}}
        onSaveWithoutOutputs={async () => {
          if (!tab) return;
          try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const selected = await save({
              filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
              defaultPath: tab.fileName.replace('.ipynb', '_clean.ipynb'),
            });
            if (!selected) return;
            // Strip outputs from all code cells
            const cleanNotebook = {
              ...tab.notebook,
              cells: tab.notebook.cells.map((cell) => ({
                ...cell,
                outputs: cell.cell_type === 'code' ? [] : cell.outputs,
                execution_count: cell.cell_type === 'code' ? null : cell.execution_count,
              })),
            };
            const { writeNotebook } = await import('./lib/ipc');
            await writeNotebook(selected, cleanNotebook);
          } catch (e: unknown) {
            setError(`Failed to save: ${e}`);
          }
        }}
        onCutCell={() => notebookRef.current?.cutCell()}
        onCopyCell={() => notebookRef.current?.copyCell()}
        onPasteCell={() => notebookRef.current?.pasteCell()}
        onDeleteCell={() => notebookRef.current?.deleteFocusedCell()}
        onUndoDelete={() => notebookRef.current?.undoDelete()}
        onInsertAbove={() => notebookRef.current?.addCellAbove('code')}
        onInsertBelow={() => notebookRef.current?.addCellBelow('code')}
        onRunCell={() => notebookRef.current?.runCell()}
        onRunAll={() => notebookRef.current?.runAll()}
        onChangeCellType={(type) => notebookRef.current?.changeFocusedCellType(type)}
        onInterruptKernel={() => notebookRef.current?.interruptKernel()}
        onRestartKernel={handleRestartKernel}
        onRestartAndClear={async () => { notebookRef.current?.clearAllOutputs(); await handleRestartKernel(); }}
        onRestartAndRunAll={async () => {
          await handleRestartKernel();
          await new Promise((r) => setTimeout(r, 500));
          notebookRef.current?.runAll();
        }}
        onToggleLineNumbers={() => notebookRef.current?.toggleLineNumbers()}
        onShowShortcuts={() => setShowShortcuts(true)}
        fileName={tab.fileName}
        hasKernel={!!tab.kernelId}
      />

      {/* Main workspace: sidebar + content */}
      <div className="app-workspace">
        <Sidebar width={sidebarWidth} onResize={handleSidebarResize} />

        <div className="main-content">
          {/* Tab Bar */}
          <TabBar />

          {/* Toolbar */}
          <div className="toolbar">
        <div className="toolbar-group">
          <button onClick={handleSaveFile} className="toolbar-btn" title="Save (Ctrl+S)">💾</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.addCellBelow('code')} className="toolbar-btn" title="Insert Cell Below">+</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.cutCell()} className="toolbar-btn" title="Cut Cell">✂</button>
          <button onClick={() => notebookRef.current?.copyCell()} className="toolbar-btn" title="Copy Cell">⧉</button>
          <button onClick={() => notebookRef.current?.pasteCell()} className="toolbar-btn" title="Paste Cell Below">📋</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.moveFocusedCell('up')} className="toolbar-btn" title="Move Up">↑</button>
          <button onClick={() => notebookRef.current?.moveFocusedCell('down')} className="toolbar-btn" title="Move Down">↓</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.runCell()} className="toolbar-btn run-btn" title="Run (Shift+Enter)" disabled={!tab.kernelId}>▶ Run</button>
          <button onClick={() => notebookRef.current?.interruptKernel()} className="toolbar-btn" title="Interrupt" disabled={!tab.kernelId}>⏹</button>
          <button onClick={handleRestartKernel} className="toolbar-btn" title="Restart Kernel" disabled={!tab.kernelId}>⟳</button>
        </div>
        <div className="toolbar-group">
          <select className="cell-type-select" value={tab.focusedCellType} onChange={(e) => notebookRef.current?.changeFocusedCellType(e.target.value as 'code' | 'markdown')}>
            <option value="code">Code</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>
        <div className="toolbar-spacer" />
        {!tab.kernelId ? (
          kernelspecs.length > 0 && (
            <div className="toolbar-group">
              <select className="kernel-select" defaultValue="" onChange={(e) => { if (e.target.value) handleStartKernel(e.target.value); }}>
                <option value="" disabled>Start Kernel...</option>
                {kernelspecs.map((spec) => (
                  <option key={spec.name} value={spec.name}>{spec.display_name}</option>
                ))}
              </select>
            </div>
          )
        ) : (
          <div className="kernel-status">
            <span className={`status-dot ${tab.kernelStatus}`} />
            {tab.kernelStatus}
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab.isLauncher ? (
        <Launcher />
      ) : (tab.suspensionLayer === 'layerA' || tab.suspensionLayer === 'layerC') ? (
        <SuspendedPlaceholder
          tab={tab}
          onResume={() => {
            updateActiveTab({ suspensionLayer: 'active' });
            if (tab.suspensionLayer === 'layerC') {
              // Kernel was stopped, offer to restart
              const specs = useAppStore.getState().kernelspecs;
              if (specs.length > 0) {
                handleStartKernel(specs[0].name);
              }
            }
          }}
        />
      ) : (
        <Notebook
          key={tab.id}
          ref={notebookRef}
          notebook={tab.notebook}
          kernelId={tab.kernelId}
          onNotebookChange={(nb) => updateActiveTab({ notebook: nb })}
          onDirty={() => updateActiveTab({ isDirty: true })}
          onFocusedCellChange={(type) => updateActiveTab({ focusedCellType: type })}
          onEditModeChange={(mode) => updateActiveTab({ editMode: mode })}
          onInterruptKernel={() => {
            if (tab.kernelId) {
              import('./lib/ipc').then(({ interruptKernel }) => interruptKernel(tab.kernelId!));
            }
          }}
          onRestartKernel={handleRestartKernel}
          onSave={handleSaveFile}
        />
      )}
        </div>{/* end .main-content */}
      </div>{/* end .app-workspace */}

      <StatusBar />

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;
