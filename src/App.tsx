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
import SettingsPanel from './components/settings/SettingsPanel';
import TerminalPanel from './components/terminal/Terminal';
import CommandPalette from './components/toolbar/CommandPalette';
import type { Command } from './components/toolbar/CommandPalette';
import { useSuspension } from './hooks/useSuspension';
import { useAutosave } from './hooks/useAutosave';
import { useAppStore } from './store';
import { listKernelspecs, startKernel, stopKernel, readNotebook, writeNotebook } from './lib/ipc';
import './App.css';

function App() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const kernelspecs = useAppStore((s) => s.kernelspecs);
  const error = useAppStore((s) => s.error);
  const showShortcuts = useAppStore((s) => s.showShortcuts);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const editorFontSize = useAppStore((s) => s.appSettings.editor_font_size);

  // Apply settings as CSS variables so CodeMirror picks them up
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  }, [editorFontSize]);
  const notebookRef = useRef<NotebookHandle>(null);

  // Initialize suspension timer system and autosave
  useSuspension();
  useAutosave();

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

    // Load settings from disk into store
    import('./lib/ipc').then(({ getSettings }) => {
      getSettings().then((s) => {
        useAppStore.getState().setAppSettings(s);
      }).catch(() => {});
    });
  }, []);

  // Restore notebook data for tabs loaded from localStorage (Ctrl+R recovery)
  useEffect(() => {
    const loadRestoredTabs = async () => {
      // Small delay to ensure Tauri IPC is ready
      await new Promise((r) => setTimeout(r, 500));
      const store = useAppStore.getState();
      for (const tab of store.tabs) {
        if (tab.filePath && !tab.isLauncher) {
          try {
            const nb = await readNotebook(tab.filePath);
            useAppStore.getState().updateTab(tab.id, { notebook: nb });
          } catch {
            // File might not exist, remove the tab
            useAppStore.getState().removeTab(tab.id);
          }
        }
      }
    };
    loadRestoredTabs();
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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
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
        onDownloadPy={async () => {
          if (!tab) return;
          try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const selected = await save({
              filters: [{ name: 'Python Script', extensions: ['py'] }],
              defaultPath: tab.fileName.replace('.ipynb', '.py'),
            });
            if (!selected) return;
            // Convert notebook cells to Python script
            const lines: string[] = [];
            lines.push('#!/usr/bin/env python3');
            lines.push('# Converted from: ' + tab.fileName);
            lines.push('');
            for (const cell of tab.notebook.cells) {
              const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
              if (cell.cell_type === 'code') {
                lines.push(source);
                lines.push('');
              } else if (cell.cell_type === 'markdown') {
                // Convert markdown to Python comments
                for (const line of source.split('\n')) {
                  lines.push('# ' + line);
                }
                lines.push('');
              }
            }
            const content = lines.join('\n');
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('write_text_file', { path: selected, content });
          } catch (e: unknown) {
            setError(`Export failed: ${e}`);
          }
        }}
        onDownloadHtml={async () => {
          if (!tab) return;
          try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const selected = await save({
              filters: [{ name: 'HTML', extensions: ['html'] }],
              defaultPath: tab.fileName.replace('.ipynb', '.html'),
            });
            if (!selected) return;

            // Build a standalone HTML file with all cell contents and outputs
            const parts: string[] = [];
            parts.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
            parts.push(`<title>${tab.fileName}</title>`);
            parts.push('<style>body{font-family:"Helvetica Neue",Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#333}');
            parts.push('pre{background:#f7f7f7;border:1px solid #ccc;border-radius:3px;padding:12px;overflow-x:auto;font-family:Menlo,Monaco,Consolas,monospace;font-size:14px}');
            parts.push('.cell{margin:16px 0}.output{margin:8px 0 8px 0;color:#000}');
            parts.push('.markdown{line-height:1.6}.stderr{background:#fdd}img{max-width:100%}');
            parts.push('table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #000;padding:4px 8px;text-align:right}');
            parts.push('</style></head><body>');

            for (const cell of tab.notebook.cells) {
              const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
              parts.push('<div class="cell">');

              if (cell.cell_type === 'markdown') {
                parts.push(`<div class="markdown">${source.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`);
              } else if (cell.cell_type === 'code') {
                parts.push(`<pre>${source.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
                if (cell.outputs) {
                  for (const output of cell.outputs) {
                    if (output.output_type === 'stream') {
                      const text = Array.isArray(output.text) ? output.text.join('') : (output.text ?? '');
                      const cls = output.name === 'stderr' ? 'output stderr' : 'output';
                      parts.push(`<pre class="${cls}">${text.replace(/</g, '&lt;')}</pre>`);
                    } else if (output.data) {
                      const data = output.data as Record<string, unknown>;
                      if (data['text/html']) {
                        parts.push(`<div class="output">${data['text/html']}</div>`);
                      } else if (data['image/png']) {
                        parts.push(`<div class="output"><img src="data:image/png;base64,${data['image/png']}"></div>`);
                      } else if (data['text/plain']) {
                        const t = Array.isArray(data['text/plain']) ? (data['text/plain'] as string[]).join('') : data['text/plain'] as string;
                        parts.push(`<pre class="output">${t.replace(/</g, '&lt;')}</pre>`);
                      }
                    } else if (output.output_type === 'error') {
                      parts.push(`<pre class="output" style="color:darkred">${(output.traceback ?? []).join('\n').replace(/</g, '&lt;')}</pre>`);
                    }
                  }
                }
              }
              parts.push('</div>');
            }
            parts.push('</body></html>');

            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('write_text_file', { path: selected, content: parts.join('\n') });
          } catch (e: unknown) {
            setError(`Export failed: ${e}`);
          }
        }}
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
        onRunAllAbove={() => notebookRef.current?.runAllAbove()}
        onRunAllBelow={() => notebookRef.current?.runAllBelow()}
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
        onToggleTerminal={() => setShowTerminal((v) => !v)}
        onShowShortcuts={() => setShowShortcuts(true)}
        onShowSettings={() => setShowSettings(true)}
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
          <TerminalPanel visible={showTerminal} onClose={() => setShowTerminal(false)} />
        </div>{/* end .main-content */}
      </div>{/* end .app-workspace */}

      <StatusBar />

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          commands={[
            { id: 'file.new', label: 'New Notebook', shortcut: '', action: handleNewNotebook },
            { id: 'file.open', label: 'Open File', shortcut: 'Ctrl+O', action: handleOpenFile },
            { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', action: handleSaveFile },
            { id: 'file.saveAs', label: 'Save As', action: handleSaveAs },
            { id: 'cell.run', label: 'Run Cell', shortcut: 'Shift+Enter', action: () => notebookRef.current?.runCell() },
            { id: 'cell.runAll', label: 'Run All Cells', action: () => notebookRef.current?.runAll() },
            { id: 'cell.runAbove', label: 'Run All Above', action: () => notebookRef.current?.runAllAbove() },
            { id: 'cell.runBelow', label: 'Run All Below', action: () => notebookRef.current?.runAllBelow() },
            { id: 'cell.addAbove', label: 'Insert Cell Above', shortcut: 'A', action: () => notebookRef.current?.addCellAbove('code') },
            { id: 'cell.addBelow', label: 'Insert Cell Below', shortcut: 'B', action: () => notebookRef.current?.addCellBelow('code') },
            { id: 'cell.delete', label: 'Delete Cell', shortcut: 'D,D', action: () => notebookRef.current?.deleteFocusedCell() },
            { id: 'cell.cut', label: 'Cut Cell', shortcut: 'X', action: () => notebookRef.current?.cutCell() },
            { id: 'cell.copy', label: 'Copy Cell', shortcut: 'C', action: () => notebookRef.current?.copyCell() },
            { id: 'cell.paste', label: 'Paste Cell', shortcut: 'V', action: () => notebookRef.current?.pasteCell() },
            { id: 'cell.toCode', label: 'Change Cell to Code', shortcut: 'Y', action: () => notebookRef.current?.changeFocusedCellType('code') },
            { id: 'cell.toMarkdown', label: 'Change Cell to Markdown', shortcut: 'M', action: () => notebookRef.current?.changeFocusedCellType('markdown') },
            { id: 'cell.toggleOutput', label: 'Toggle Cell Output', shortcut: 'O', action: () => {} },
            { id: 'cell.toggleLineNumbers', label: 'Toggle Line Numbers', shortcut: 'L', action: () => notebookRef.current?.toggleLineNumbers() },
            { id: 'cell.clearOutputs', label: 'Clear All Outputs', action: () => notebookRef.current?.clearAllOutputs() },
            { id: 'kernel.interrupt', label: 'Interrupt Kernel', shortcut: 'I,I', action: () => { if (tab?.kernelId) import('./lib/ipc').then(({ interruptKernel }) => interruptKernel(tab.kernelId!)); } },
            { id: 'kernel.restart', label: 'Restart Kernel', shortcut: '0,0', action: handleRestartKernel },
            { id: 'help.shortcuts', label: 'Show Keyboard Shortcuts', shortcut: 'H', action: () => setShowShortcuts(true) },
            { id: 'help.palette', label: 'Command Palette', shortcut: 'Ctrl+Shift+P', action: () => setShowCommandPalette(true) },
          ] satisfies Command[]}
        />
      )}
    </div>
  );
}

export default App;
