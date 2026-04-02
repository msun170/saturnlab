import { useState, useEffect, useCallback, useRef } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import Notebook from './components/notebook/Notebook';
import type { NotebookHandle } from './components/notebook/Notebook';
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

      console.log('[Saturn] Opening notebook:', path);
      const nb = await readNotebook(path);
      console.log('[Saturn] Loaded notebook with', nb.cells.length, 'cells');
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
      {/* Menu bar */}
      <div className="menu-bar">
        <span className="menu-item" onClick={handleOpenFile}>File</span>
        <span className="menu-item">Edit</span>
        <span className="menu-item">View</span>
        <span className="menu-item">Insert</span>
        <span className="menu-item">Cell</span>
        <span className="menu-item">Kernel</span>
        <span className="menu-item">Help</span>
        <span className="file-name">{fileName}</span>
      </div>

      {/* Toolbar — matches classic Jupyter Notebook layout */}
      <div className="toolbar">
        {/* Group 1: Save */}
        <div className="toolbar-group">
          <button onClick={handleSaveFile} className="toolbar-btn" title="Save (Ctrl+S)">
            💾
          </button>
        </div>

        {/* Group 2: Insert Cell Below */}
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.addCellBelow('code')} className="toolbar-btn" title="Insert Cell Below">
            +
          </button>
        </div>

        {/* Group 3: Cut/Copy/Paste Cells */}
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.cutCell()} className="toolbar-btn" title="Cut Cell">
            ✂
          </button>
          <button onClick={() => notebookRef.current?.copyCell()} className="toolbar-btn" title="Copy Cell">
            ⧉
          </button>
          <button onClick={() => notebookRef.current?.pasteCell()} className="toolbar-btn" title="Paste Cell Below">
            📋
          </button>
        </div>

        {/* Group 4: Move Cells */}
        <div className="toolbar-group">
          <button onClick={() => notebookRef.current?.moveFocusedCell('up')} className="toolbar-btn" title="Move Cell Up">
            ↑
          </button>
          <button onClick={() => notebookRef.current?.moveFocusedCell('down')} className="toolbar-btn" title="Move Cell Down">
            ↓
          </button>
        </div>

        {/* Group 5: Run / Stop / Restart */}
        <div className="toolbar-group">
          <button
            onClick={() => notebookRef.current?.runCell()}
            className="toolbar-btn run-btn"
            title="Run Cell (Shift+Enter)"
            disabled={!kernelId}
          >
            ▶ Run
          </button>
          <button
            onClick={() => notebookRef.current?.interruptKernel()}
            className="toolbar-btn"
            title="Interrupt Kernel"
            disabled={!kernelId}
          >
            ⏹
          </button>
          <button
            onClick={async () => {
              if (kernelId) {
                await handleStopKernel();
                if (kernelspecs.length > 0) {
                  handleStartKernel(kernelspecs[0].name);
                }
              }
            }}
            className="toolbar-btn"
            title="Restart Kernel"
            disabled={!kernelId}
          >
            ⟳
          </button>
        </div>

        {/* Group 6: Cell Type Selector */}
        <div className="toolbar-group">
          <select
            className="cell-type-select"
            value={focusedCellType}
            onChange={(e) => notebookRef.current?.changeFocusedCellType(e.target.value as 'code' | 'markdown')}
          >
            <option value="code">Code</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>

        {/* Kernel selector (right side) */}
        <div className="toolbar-spacer" />

        {!kernelId ? (
          kernelspecs.length > 0 && (
            <div className="toolbar-group">
              <select
                className="kernel-select"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleStartKernel(e.target.value);
                }}
              >
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
    </div>
  );
}

export default App;
