import { useState, useCallback, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { listen } from '@tauri-apps/api/event';
import CodeCell from './CodeCell';
import SearchBar from './SearchBar';
import MarkdownCell from './MarkdownCell';
import OutputArea from '../output/OutputArea';
import type { Cell, Output, Notebook as NotebookType } from '../../types/notebook';
import type { KernelOutput } from '../../types/kernel';
import { executeCode } from '../../lib/ipc';
import { formatBytes } from '../../types/memory';
import { useAppStore } from '../../store';

interface CellState {
  id: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string;
  outputs: Output[];
  execution_count: number | null;
  isRunning: boolean;
  outputHidden: boolean;
  memoryDelta: number | null;
  collapsed: boolean; // for collapsible headings // bytes change after execution
}

interface NotebookProps {
  notebook: NotebookType;
  kernelId: string | null;
  onNotebookChange: (notebook: NotebookType) => void;
  onDirty?: () => void;
  onFocusedCellChange?: (cellType: string, index: number) => void;
  onEditModeChange?: (editMode: boolean) => void;
  onInterruptKernel?: () => void;
  onRestartKernel?: () => void;
  onSave?: () => void;
}

let cellIdCounter = 0;
function generateCellId(): string {
  return `cell-${Date.now()}-${cellIdCounter++}`;
}

function cellFromNotebook(cell: Cell): CellState {
  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
  return {
    id: cell.id ?? generateCellId(),
    cell_type: cell.cell_type,
    source,
    outputs: cell.outputs ?? [],
    execution_count: typeof cell.execution_count === 'number' ? cell.execution_count : null,
    isRunning: false,
    outputHidden: false,
    memoryDelta: null,
    collapsed: false,
  };
}

/** Methods exposed to parent via ref for toolbar integration. */
export interface NotebookHandle {
  runCell: () => void;
  runAll: () => void;
  runAllAbove: () => void;
  runAllBelow: () => void;
  addCellBelow: (type: 'code' | 'markdown') => void;
  addCellAbove: (type: 'code' | 'markdown') => void;
  deleteFocusedCell: () => void;
  moveFocusedCell: (dir: 'up' | 'down') => void;
  getFocusedCellType: () => 'code' | 'markdown' | 'raw';
  changeFocusedCellType: (type: 'code' | 'markdown') => void;
  cutCell: () => void;
  copyCell: () => void;
  pasteCell: () => void;
  undoDelete: () => void;
  clearAllOutputs: () => void;
  toggleLineNumbers: () => void;
  interruptKernel: () => void;
}

const Notebook = forwardRef<NotebookHandle, NotebookProps>(function Notebook({ notebook, kernelId, onNotebookChange, onDirty, onFocusedCellChange, onEditModeChange, onInterruptKernel, onRestartKernel, onSave }, ref) {
  const [cells, setCells] = useState<CellState[]>(() =>
    notebook.cells.map(cellFromNotebook),
  );
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [editMode, setEditModeInternal] = useState(false);

  // Wrap setEditMode to notify parent
  const setEditMode = useCallback((mode: boolean) => {
    setEditModeInternal(mode);
    onEditModeChange?.(mode);
  }, [onEditModeChange]);

  // Notify parent of focused cell changes (for toolbar cell type dropdown)
  // Only trigger on focusedIndex change or cell type change, NOT on cells content change
  const focusedCellType = cells[focusedIndex]?.cell_type ?? 'code';
  useEffect(() => {
    onFocusedCellChange?.(focusedCellType, focusedIndex);
  }, [focusedIndex, focusedCellType]);

  // Track which msg_id belongs to which cell. Using ref instead of state
  // because we don't need React re-renders when this changes.
  const pendingRef = useRef(new Map<string, string>());
  const kernelIdRef = useRef(kernelId);
  kernelIdRef.current = kernelId;

  // Listen for kernel output events and route to the correct cell
  useEffect(() => {
    const unlisten = listen<KernelOutput>('kernel-output', (event) => {
      const { msg_type, content, parent_msg_id, kernel_id } = event.payload;

      // Only process messages from our kernel (multi-kernel isolation)
      // Use kernelIdRef to avoid stale closure (effect runs once with [] deps)
      if (kernelIdRef.current && kernel_id !== kernelIdRef.current) return;

      // Find which cell this output belongs to
      const cellId = pendingRef.current.get(parent_msg_id);
      if (!cellId) return;

      setCells((prevCells) =>
        prevCells.map((cell) => {
          if (cell.id !== cellId) return cell;

          switch (msg_type) {
            case 'stream': {
              const text = (content.text as string) ?? '';
              const newOutput: Output = {
                output_type: 'stream',
                text,
                name: (content.name as string) ?? 'stdout',
              };
              return { ...cell, outputs: [...cell.outputs, newOutput] };
            }
            case 'execute_result': {
              const newOutput: Output = {
                output_type: 'execute_result',
                data: content.data as Record<string, unknown>,
                execution_count: content.execution_count as number | null,
              };
              return {
                ...cell,
                outputs: [...cell.outputs, newOutput],
                execution_count: (content.execution_count as number) ?? cell.execution_count,
              };
            }
            case 'display_data': {
              const newOutput: Output = {
                output_type: 'display_data',
                data: content.data as Record<string, unknown>,
              };
              return { ...cell, outputs: [...cell.outputs, newOutput] };
            }
            case 'error': {
              const newOutput: Output = {
                output_type: 'error',
                ename: content.ename as string,
                evalue: content.evalue as string,
                traceback: content.traceback as string[],
              };
              return { ...cell, outputs: [...cell.outputs, newOutput] };
            }
            case 'execute_input': {
              // Kernel broadcasts this on iopub when it starts executing.
              // Contains execution_count. This is how we get In [n]:
              const execCount = content.execution_count as number | undefined;
              if (execCount != null) {
                return { ...cell, execution_count: execCount };
              }
              return cell;
            }
            case 'status': {
              if (content.execution_state === 'idle') {
                return { ...cell, isRunning: false };
              }
              return cell;
            }
            default:
              return cell;
          }
        }),
      );

      // Clean up pending execution when kernel goes idle for this msg
      if (msg_type === 'status' && content.execution_state === 'idle') {
        pendingRef.current.delete(parent_msg_id);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Sync cells back to notebook format when they change
  useEffect(() => {
    const updatedNotebook: NotebookType = {
      ...notebook,
      cells: cells.map((cell) => ({
        cell_type: cell.cell_type,
        source: cell.source,
        metadata: {},
        outputs: cell.cell_type === 'code' ? cell.outputs : undefined,
        execution_count: cell.cell_type === 'code' ? cell.execution_count : undefined,
        id: cell.id,
      })),
    };
    onNotebookChange(updatedNotebook);
  }, [cells]);

  const handleExecuteCell = useCallback(
    async (index: number) => {
      if (!kernelId) return;
      const cell = cells[index];
      if (cell.cell_type !== 'code') {
        // For markdown, just advance to next cell
        setFocusedIndex(Math.min(index + 1, cells.length - 1));
        return;
      }

      // Clear outputs and mark as running
      setCells((prev) =>
        prev.map((c, i) => (i === index ? { ...c, outputs: [], isRunning: true } : c)),
      );
      onDirty?.(); // Execution changes outputs, mark as dirty

      try {
        // Get memory before execution for delta calculation
        let memBefore: number | null = null;
        try {
          const { getKernelMemory } = await import('../../lib/ipc');
          const info = await getKernelMemory(kernelId);
          memBefore = info.kernel_rss;
        } catch { /* ignore if memory check fails */ }

        const msgId = crypto.randomUUID();
        pendingRef.current.set(msgId, cell.id);
        await executeCode(kernelId, cell.source, false, msgId);

        // Wait for kernel to go idle, then measure memory delta
        if (memBefore !== null) {
          const cellId = cell.id;
          const kId = kernelId;
          const unlisten = listen<KernelOutput>('kernel-output', async (event) => {
            const { msg_type, content, parent_msg_id } = event.payload;
            if (parent_msg_id !== msgId) return;
            if (msg_type === 'status' && content.execution_state === 'idle') {
              unlisten.then((fn) => fn());
              try {
                // Force GC and trim inside the kernel so OS reclaims freed pages
                const gcMsgId = crypto.randomUUID();
                await executeCode(kId, 'import gc as _gc; _gc.collect()', true, gcMsgId);

                // Wait for kernel to finish GC and OS to update RSS
                await new Promise((r) => setTimeout(r, 2000));

                const { getKernelMemory } = await import('../../lib/ipc');
                const info = await getKernelMemory(kId);
                const delta = info.kernel_rss - memBefore!;
                setCells((prev) =>
                  prev.map((c) =>
                    c.id === cellId ? { ...c, memoryDelta: delta } : c,
                  ),
                );
              } catch { /* ignore */ }
            }
          });
        }
      } catch (e: unknown) {
        setCells((prev) =>
          prev.map((c, i) =>
            i === index
              ? {
                  ...c,
                  isRunning: false,
                  outputs: [
                    {
                      output_type: 'error' as const,
                      ename: 'ExecutionError',
                      evalue: String(e),
                      traceback: [String(e)],
                    },
                  ],
                }
              : c,
          ),
        );
      }

      // Advance to next cell
      setFocusedIndex(Math.min(index + 1, cells.length - 1));
    },
    [kernelId, cells],
  );

  const handleCellChange = useCallback((index: number, source: string) => {
    setCells((prev) =>
      prev.map((c, i) => (i === index ? { ...c, source } : c)),
    );
    onDirty?.();
  }, [onDirty]);

  // ─── Cell Operations ───────────────────────────────────────────

  const addCell = useCallback((index: number, type: 'code' | 'markdown') => {
    const newCell: CellState = {
      id: generateCellId(),
      cell_type: type,
      source: '',
      outputs: [],
      execution_count: null,
      isRunning: false,
      outputHidden: false,
      memoryDelta: null,
      collapsed: false,
    };
    setCells((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, newCell);
      return next;
    });
    setFocusedIndex(index + 1);
  }, []);

  const deleteCell = useCallback(
    (index: number) => {
      if (cells.length <= 1) return; // Don't delete the last cell
      setCells((prev) => prev.filter((_, i) => i !== index));
      setFocusedIndex(Math.min(index, cells.length - 2));
    },
    [cells.length],
  );

  const moveCell = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= cells.length) return;
      setCells((prev) => {
        const next = [...prev];
        [next[index], next[newIndex]] = [next[newIndex], next[index]];
        return next;
      });
      setFocusedIndex(newIndex);
    },
    [cells.length],
  );

  const addCellAbove = useCallback((index: number, type: 'code' | 'markdown') => {
    const newCell: CellState = {
      id: generateCellId(),
      cell_type: type,
      source: '',
      outputs: [],
      execution_count: null,
      isRunning: false,
      outputHidden: false,
      memoryDelta: null,
      collapsed: false,
    };
    setCells((prev) => {
      const next = [...prev];
      next.splice(index, 0, newCell);
      return next;
    });
    // Focus stays at same index (which is now the new cell)
  }, []);

  // ─── Collapsible Headings ─────────────────────────────────────

  const getHeadingLevel = (source: string): number => {
    const match = source.match(/^(#{1,6})\s/);
    return match ? match[1].length : 0;
  };

  const toggleCollapse = useCallback((index: number) => {
    setCells((prev) => {
      const cell = prev[index];
      const newCollapsed = !cell.collapsed;
      return prev.map((c, i) => (i === index ? { ...c, collapsed: newCollapsed } : c));
    });
  }, []);

  // Determine which cells are hidden due to a collapsed heading above them
  const hiddenCells = useMemo(() => {
    const hidden = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.cell_type === 'markdown' && cell.collapsed) {
        const level = getHeadingLevel(cell.source);
        if (level === 0) continue;
        // Hide all cells below until we hit a heading of same or higher level
        for (let j = i + 1; j < cells.length; j++) {
          const below = cells[j];
          if (below.cell_type === 'markdown') {
            const belowLevel = getHeadingLevel(below.source);
            if (belowLevel > 0 && belowLevel <= level) break;
          }
          hidden.add(j);
        }
      }
    }
    return hidden;
  }, [cells]);

  const changeCellType = useCallback((index: number, newType: 'code' | 'markdown') => {
    setCells((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, cell_type: newType, outputs: [], execution_count: null } : c,
      ),
    );
  }, []);

  // ─── Clipboard ─────────────────────────────────────────────────

  const [clipboard, setClipboard] = useState<CellState | null>(null);
  const [deletedCells, setDeletedCells] = useState<{ cell: CellState; index: number }[]>([]);

  const cutCell = useCallback(
    (index: number) => {
      if (cells.length <= 1) return;
      const cell = cells[index];
      setClipboard(cell);
      setDeletedCells((prev) => [...prev, { cell, index }]);
      setCells((prev) => prev.filter((_, i) => i !== index));
      setFocusedIndex(Math.min(index, cells.length - 2));
    },
    [cells],
  );

  const copyCell = useCallback(
    (index: number) => {
      setClipboard({ ...cells[index], id: generateCellId() });
    },
    [cells],
  );

  const pasteCell = useCallback(
    (index: number) => {
      if (!clipboard) return;
      const pasted = { ...clipboard, id: generateCellId() };
      setCells((prev) => {
        const next = [...prev];
        next.splice(index + 1, 0, pasted);
        return next;
      });
      setFocusedIndex(index + 1);
    },
    [clipboard],
  );

  const undoDelete = useCallback(() => {
    if (deletedCells.length === 0) return;
    const last = deletedCells[deletedCells.length - 1];
    setCells((prev) => {
      const next = [...prev];
      next.splice(last.index, 0, last.cell);
      return next;
    });
    setDeletedCells((prev) => prev.slice(0, -1));
    setFocusedIndex(last.index);
  }, [deletedCells]);

  // ─── Run All ───────────────────────────────────────────────────

  const runAll = useCallback(async () => {
    if (!kernelId) return;
    const currentCells = [...cells];
    for (let i = 0; i < currentCells.length; i++) {
      if (currentCells[i].cell_type !== 'code') continue;

      setCells((prev) =>
        prev.map((c, idx) => (idx === i ? { ...c, outputs: [], isRunning: true } : c)),
      );

      try {
        const msgId = crypto.randomUUID();
        pendingRef.current.set(msgId, currentCells[i].id);

        // Set up the listener BEFORE sending so we don't miss the idle message
        const idlePromise = new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 60000);
          const unsub = listen<KernelOutput>('kernel-output', (event) => {
            const { msg_type: mt, content: ct, parent_msg_id: pid } = event.payload;
            if (pid !== msgId) return;
            if (mt === 'status' && ct.execution_state === 'idle') {
              clearTimeout(timeout);
              unsub.then((fn) => fn());
              resolve();
            }
          });
        });

        await executeCode(kernelId, currentCells[i].source, false, msgId);
        await idlePromise;
      } catch {
        // If one cell fails, continue to next
      }
    }
  }, [kernelId, cells]);

  const runCellRange = useCallback(async (startIdx: number, endIdx: number) => {
    if (!kernelId) return;
    const currentCells = [...cells];
    for (let i = startIdx; i <= endIdx && i < currentCells.length; i++) {
      if (currentCells[i].cell_type !== 'code') continue;
      setCells((prev) =>
        prev.map((c, idx) => (idx === i ? { ...c, outputs: [], isRunning: true } : c)),
      );
      try {
        const msgId = crypto.randomUUID();
        pendingRef.current.set(msgId, currentCells[i].id);
        const idlePromise = new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 60000);
          const unsub = listen<KernelOutput>('kernel-output', (event) => {
            const { msg_type: mt, content: ct, parent_msg_id: pid } = event.payload;
            if (pid !== msgId) return;
            if (mt === 'status' && ct.execution_state === 'idle') {
              clearTimeout(timeout);
              unsub.then((fn) => fn());
              resolve();
            }
          });
        });
        await executeCode(kernelId, currentCells[i].source, false, msgId);
        await idlePromise;
      } catch { /* continue */ }
    }
  }, [kernelId, cells]);

  // ─── Clear All Outputs ─────────────────────────────────────────

  const clearAllOutputs = useCallback(() => {
    setCells((prev) =>
      prev.map((c) => ({
        ...c,
        outputs: [],
        execution_count: null,
        isRunning: false,
      })),
    );
  }, []);

  // ─── Line Numbers Toggle ───────────────────────────────────────

  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [_dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleSearch = useCallback((query: string, matchCase: boolean) => {
    const results: { cellIndex: number; lineNumber: number; text: string }[] = [];
    const q = matchCase ? query : query.toLowerCase();
    cells.forEach((cell, index) => {
      const src = matchCase ? cell.source : cell.source.toLowerCase();
      const lines = src.split('\n');
      lines.forEach((line, lineNum) => {
        if (line.includes(q)) {
          results.push({ cellIndex: index, lineNumber: lineNum, text: line.trim() });
        }
      });
    });
    return results;
  }, [cells]);

  const handleReplace = useCallback((query: string, replacement: string, matchCase: boolean) => {
    // Replace first occurrence in the focused cell
    setCells((prev) =>
      prev.map((c, i) => {
        if (i !== focusedIndex) return c;
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? '' : 'i');
        return { ...c, source: c.source.replace(regex, replacement) };
      }),
    );
    onDirty?.();
  }, [focusedIndex, onDirty]);

  const handleReplaceAll = useCallback((query: string, replacement: string, matchCase: boolean) => {
    const flags = matchCase ? 'g' : 'gi';
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    setCells((prev) =>
      prev.map((c) => ({ ...c, source: c.source.replace(regex, replacement) })),
    );
    onDirty?.();
  }, [onDirty]);

  const toggleLineNumbers = useCallback(() => {
    setShowLineNumbers((prev) => !prev);
  }, []);

  // ─── Expose methods to parent via ref ───────────────────────────

  useImperativeHandle(ref, () => ({
    runCell: () => handleExecuteCell(focusedIndex),
    runAll,
    runAllAbove: () => runCellRange(0, focusedIndex - 1),
    runAllBelow: () => runCellRange(focusedIndex, cells.length - 1),
    addCellBelow: (type: 'code' | 'markdown') => addCell(focusedIndex, type),
    addCellAbove: (type: 'code' | 'markdown') => addCellAbove(focusedIndex, type),
    deleteFocusedCell: () => deleteCell(focusedIndex),
    moveFocusedCell: (dir: 'up' | 'down') => moveCell(focusedIndex, dir),
    getFocusedCellType: () => cells[focusedIndex]?.cell_type ?? 'code',
    changeFocusedCellType: (type: 'code' | 'markdown') => changeCellType(focusedIndex, type),
    cutCell: () => cutCell(focusedIndex),
    copyCell: () => copyCell(focusedIndex),
    pasteCell: () => pasteCell(focusedIndex),
    undoDelete,
    clearAllOutputs,
    toggleLineNumbers,
    interruptKernel: () => {
      if (kernelId) {
        import('../../lib/ipc').then(({ interruptKernel }) => interruptKernel(kernelId));
      }
    },
  }), [focusedIndex, cells, kernelId, clipboard, deletedCells, handleExecuteCell, runAll, runCellRange, addCell, addCellAbove, deleteCell, moveCell, changeCellType, cutCell, copyCell, pasteCell, undoDelete, clearAllOutputs, toggleLineNumbers]);

  // ─── Keyboard shortcuts (command mode) ─────────────────────────
  // Matches Jupyter keyboardmanager.js including d,d / i,i / 0,0 double-press

  const lastKeyRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        return;
      }

      // Ctrl+F opens search regardless of mode
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      const now = Date.now();
      const isDoublePress = (key: string) => {
        return lastKeyRef.current.key === key && (now - lastKeyRef.current.time) < 500;
      };

      // Double-press detection: check BEFORE handling
      const isDouble = isDoublePress(e.key);

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          setEditMode(true);
          break;
        case 'Escape':
          e.preventDefault();
          setEditMode(false);
          break;
        case 'a':
          e.preventDefault();
          addCellAbove(focusedIndex, 'code');
          break;
        case 'b':
          e.preventDefault();
          addCell(focusedIndex, 'code');
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, cells.length - 1));
          setEditMode(false);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          setEditMode(false);
          break;
        case 'm':
          e.preventDefault();
          changeCellType(focusedIndex, 'markdown');
          break;
        case 'y':
          e.preventDefault();
          changeCellType(focusedIndex, 'code');
          break;
        case 'x':
          e.preventDefault();
          cutCell(focusedIndex);
          break;
        case 'c':
          e.preventDefault();
          copyCell(focusedIndex);
          break;
        case 'v':
          e.preventDefault();
          pasteCell(focusedIndex);
          break;
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+Z: don't intercept, let browser handle undo
            return;
          }
          e.preventDefault();
          undoDelete();
          break;
        case 's':
          e.preventDefault();
          onSave?.();
          break;
        case 'l':
          e.preventDefault();
          toggleLineNumbers();
          break;
        case 'o':
          e.preventDefault();
          setCells((prev) =>
            prev.map((c, idx) =>
              idx === focusedIndex && c.cell_type === 'code'
                ? { ...c, outputHidden: !c.outputHidden }
                : c,
            ),
          );
          break;
        // Double-press shortcuts (Jupyter d,d / i,i / 0,0)
        case 'd':
          e.preventDefault();
          if (isDouble) {
            deleteCell(focusedIndex);
          }
          break;
        case 'i':
          e.preventDefault();
          if (isDouble) {
            onInterruptKernel?.();
          }
          break;
        case '0':
          e.preventDefault();
          if (isDouble) {
            onRestartKernel?.();
          }
          break;
      }

      // Track last key for double-press detection
      lastKeyRef.current = { key: e.key, time: now };
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, cells.length, kernelId, addCell, addCellAbove, changeCellType, cutCell, copyCell, pasteCell, undoDelete, deleteCell, toggleLineNumbers, onInterruptKernel, onRestartKernel, onSave]);

  // Read highlight from store (set by clicking "Out: XX" in status bar)
  const highlightCellIndex = useAppStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.highlightCellIndex ?? null;
  });

  const clearHighlight = useCallback(() => {
    const store = useAppStore.getState();
    const activeId = store.activeTabId;
    if (activeId) store.updateTab(activeId, { highlightCellIndex: null });
  }, []);

  return (
    <div className="notebook">
      {showSearch && (
        <SearchBar
          onClose={() => setShowSearch(false)}
          onSearch={handleSearch}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
        />
      )}
      {cells.map((cell, index) => {
        if (hiddenCells.has(index)) return null; // Hidden by collapsed heading
        const headingLevel = cell.cell_type === 'markdown' ? getHeadingLevel(cell.source) : 0;
        return (
        <div
          key={cell.id}
          className={`cell-container ${index === highlightCellIndex ? 'cell-highlighted' : ''} ${dragOverIndex === index ? 'cell-drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIndex(index); }}
          onDragLeave={() => setDragOverIndex(null)}
          onDrop={(e) => {
            e.preventDefault();
            const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (!isNaN(fromIdx) && fromIdx !== index) {
              setCells((prev) => {
                const next = [...prev];
                const [moved] = next.splice(fromIdx, 1);
                next.splice(index, 0, moved);
                return next;
              });
              setFocusedIndex(index);
              onDirty?.();
            }
            setDragIndex(null);
            setDragOverIndex(null);
          }}
        >
          {/* Drag handle - only this element is draggable, not the whole cell */}
          <div
            className="cell-drag-handle"
            draggable="true"
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData('text/plain', String(index));
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.dropEffect = 'move';
              setDragIndex(index);
            }}
            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
            title="Drag to reorder"
          >
            &#x283F;
          </div>
          {/* Highlight dismiss button */}
          {index === highlightCellIndex && (
            <button className="cell-highlight-dismiss" onClick={clearHighlight} title="Dismiss">x</button>
          )}
          {/* Cell toolbar */}
          <div className="cell-actions">
            <button onClick={() => moveCell(index, 'up')} disabled={index === 0} title="Move up">
              ↑
            </button>
            <button onClick={() => moveCell(index, 'down')} disabled={index === cells.length - 1} title="Move down">
              ↓
            </button>
            <button onClick={() => deleteCell(index)} disabled={cells.length <= 1} title="Delete cell">
              ×
            </button>
            <select
              value={cell.cell_type}
              onChange={(e) => changeCellType(index, e.target.value as 'code' | 'markdown')}
            >
              <option value="code">Code</option>
              <option value="markdown">Markdown</option>
            </select>
          </div>

          {/* Cell */}
          {cell.cell_type === 'code' ? (
            <>
              <CodeCell
                source={cell.source}
                executionCount={cell.execution_count}
                isRunning={cell.isRunning}
                isFocused={index === focusedIndex}
                isEditing={index === focusedIndex && editMode}
                showLineNumbers={showLineNumbers}
                kernelId={kernelId}
                onChange={(src) => handleCellChange(index, src)}
                onExecute={() => handleExecuteCell(index)}
                onFocus={() => { setFocusedIndex(index); setEditMode(true); }}
              >
                {cell.memoryDelta !== null && Math.abs(cell.memoryDelta) > 1024 && (
                  <div className={`cell-memory-delta ${cell.memoryDelta > 0 ? 'delta-up' : 'delta-down'}`}>
                    {cell.memoryDelta > 0 ? '+' : ''}{formatBytes(Math.abs(cell.memoryDelta))} RAM
                  </div>
                )}
                {!cell.outputHidden && <OutputArea outputs={cell.outputs} />}
              </CodeCell>
            </>
          ) : (
            <div className="markdown-cell-wrapper">
              {headingLevel > 0 && (
                <button
                  className="collapse-toggle"
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(index); }}
                  title={cell.collapsed ? 'Expand section' : 'Collapse section'}
                >
                  {cell.collapsed ? '\u25B6' : '\u25BC'}
                </button>
              )}
              <MarkdownCell
                source={cell.source}
                isFocused={index === focusedIndex}
                onChange={(src) => handleCellChange(index, src)}
                onFocus={() => setFocusedIndex(index)}
                onExecute={() => handleExecuteCell(index)}
              />
            </div>
          )}

          {/* Add cell button between cells */}
          <div className="add-cell-bar">
            <button onClick={() => addCell(index, 'code')} title="Add code cell">
              + Code
            </button>
            <button onClick={() => addCell(index, 'markdown')} title="Add markdown cell">
              + Markdown
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
});

export default Notebook;
