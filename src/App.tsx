import { useState, useEffect, useCallback, useRef } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import Notebook from './components/notebook/Notebook';
import type { NotebookHandle } from './components/notebook/Notebook';
import MenuBar from './components/toolbar/MenuBar';
import ShortcutsModal from './components/toolbar/ShortcutsModal';
import { listKernelspecs, startKernel, stopKernel, readNotebook, writeNotebook } from './lib/ipc';
import type { KernelSpec } from './types/kernel';
import type { Notebook as NotebookType } from './types/notebook';
import './App.css';

function createEmptyNotebook(): NotebookType {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
    },
    cells: [
      {
        cell_type: 'code',
        source: '',
        metadata: {},
        outputs: [],
        execution_count: null,
      },
    ],
  };
}

function App() {
  const [kernelspecs, setKernelspecs] = useState<KernelSpec[]>([]);
  const [kernelId, setKernelId] = useState<string | null>(null);
  const [kernelStatus, setKernelStatus] = useState<'disconnected' | 'starting' | 'idle' | 'busy'>('disconnected');
  const [notebook, setNotebook] = useState<NotebookType>(createEmptyNotebook);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedCellType, setFocusedCellType] = useState<string>('code');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const notebookRef = useRef<NotebookHandle>(null);

  // Discover kernelspecs on mount
  useEffect(() => {
    listKernelspecs()
      .then(setKernelspecs)
      .catch((e: unknown) => setError(`Failed to discover kernels: ${e}`));
  }, []);

  // ─── Kernel Lifecycle ──────────────────────────────────────────

  const handleStartKernel = useCallback(async (specName: string) => {
    setError(null);
    setKernelStatus('starting');
    try {
      const id = await startKernel(specName);
      setKernelId(id);
      setKernelStatus('idle');
    } catch (e: unknown) {
      setError(`Failed to start kernel: ${e}`);
      setKernelStatus('disconnected');
    }
  }, []);

  const handleStopKernel = useCallback(async () => {
    if (!kernelId) return;
    try {
      await stopKernel(kernelId);
      setKernelId(null);
      setKernelStatus('disconnected');
    } catch (e: unknown) {
      setError(`Failed to stop kernel: ${e}`);
    }
  }, [kernelId]);

  // ─── File Operations ───────────────────────────────────────────

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
      });
      if (!selected) return;

      // plugin-dialog may return string or object with path property
      const path = typeof selected === 'string' ? selected : (selected as unknown as { path: string }).path;
      if (!path) return;

      const nb = await readNotebook(path);
      setNotebook(nb);
      setFilePath(path);
      setError(null);

      // Auto-start kernel if we know the kernelspec
      if (nb.metadata.kernelspec && kernelspecs.length > 0) {
        const specName = nb.metadata.kernelspec.name;
        const found = kernelspecs.find((s) => s.name === specName);
        if (found && !kernelId) {
          handleStartKernel(specName);
        }
      }
    } catch (e: unknown) {
      setError(`Failed to open file: ${e}`);
    }
  }, [kernelspecs, kernelId, handleStartKernel]);

  const handleSaveFile = useCallback(async () => {
    try {
      let path = filePath;
      if (!path) {
        const selected = await save({
          filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
          defaultPath: 'Untitled.ipynb',
        });
        if (!selected) return;
        path = selected;
        setFilePath(path);
      }
      await writeNotebook(path!, notebook);
    } catch (e: unknown) {
      setError(`Failed to save file: ${e}`);
    }
  }, [filePath, notebook]);

  const handleSaveAs = useCallback(async () => {
    try {
      const selected = await save({
        filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }],
        defaultPath: 'Untitled.ipynb',
      });
      if (!selected) return;
      setFilePath(selected);
      await writeNotebook(selected, notebook);
    } catch (e: unknown) {
      setError(`Failed to save: ${e}`);
    }
  }, [notebook]);

  const handleNewNotebook = useCallback(() => {
    setNotebook(createEmptyNotebook());
    setFilePath(null);
  }, []);

  const handleRestartKernel = useCallback(async () => {
    if (!kernelId) return;
    const specName = kernelspecs.length > 0 ? kernelspecs[0].name : null;
    await handleStopKernel();
    if (specName) {
      await handleStartKernel(specName);
    }
  }, [kernelId, kernelspecs, handleStopKernel, handleStartKernel]);

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

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled.ipynb';

  return (
    <div className="app">
      {/* Menu bar with real dropdowns */}
      <MenuBar
        onOpen={handleOpenFile}
        onSave={handleSaveFile}
        onSaveAs={handleSaveAs}
        onNewNotebook={handleNewNotebook}
        onDownloadPy={() => {/* TODO */}}
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
          // Wait for React to propagate the new kernelId to the Notebook
          await new Promise((r) => setTimeout(r, 500));
          notebookRef.current?.runAll();
        }}
        onToggleLineNumbers={() => notebookRef.current?.toggleLineNumbers()}
        onShowShortcuts={() => setShowShortcuts(true)}
        fileName={fileName ?? 'Untitled.ipynb'}
        hasKernel={!!kernelId}
      />

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
          <button onClick={() => notebookRef.current?.runCell()} className="toolbar-btn run-btn" title="Run (Shift+Enter)" disabled={!kernelId}>▶ Run</button>
          <button onClick={() => notebookRef.current?.interruptKernel()} className="toolbar-btn" title="Interrupt" disabled={!kernelId}>⏹</button>
          <button onClick={handleRestartKernel} className="toolbar-btn" title="Restart Kernel" disabled={!kernelId}>⟳</button>
        </div>
        <div className="toolbar-group">
          <select className="cell-type-select" value={focusedCellType} onChange={(e) => notebookRef.current?.changeFocusedCellType(e.target.value as 'code' | 'markdown')}>
            <option value="code">Code</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>
        <div className="toolbar-spacer" />
        {!kernelId ? (
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
            <span className={`status-dot ${kernelStatus}`} />
            {kernelStatus}
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Notebook — key forces remount when a new file is opened */}
      <Notebook
        key={filePath ?? 'untitled'}
        ref={notebookRef}
        notebook={notebook}
        kernelId={kernelId}
        onNotebookChange={setNotebook}
        onFocusedCellChange={(type) => setFocusedCellType(type)}
      />

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;
