import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { listen } from '@tauri-apps/api/event';
import CodeCell from './CodeCell';
import MarkdownCell from './MarkdownCell';
import OutputArea from '../output/OutputArea';
import type { Cell, Output, Notebook as NotebookType } from '../../types/notebook';
import type { KernelOutput } from '../../types/kernel';
import { executeCode } from '../../lib/ipc';
import { formatBytes } from '../../types/memory';

interface CellState {
  id: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string;
  outputs: Output[];
  execution_count: number | null;
  isRunning: boolean;
  outputHidden: boolean;
  memoryDelta: number | null; // bytes change after execution
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
  };
}

/** Methods exposed to parent via ref for toolbar integration. */
export interface NotebookHandle {
  runCell: () => void;
  runAll: () => void;
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

        // Wait for kernel to go idle for this cell, THEN measure memory
        if (memBefore !== null) {
          const cellId = cell.id;
          const unlisten = listen<KernelOutput>('kernel-output', async (event) => {
            const { msg_type, content, parent_msg_id } = event.payload;
            if (parent_msg_id !== msgId) return;
            if (msg_type === 'status' && content.execution_state === 'idle') {
              unlisten.then((fn) => fn());
              // Small delay for OS to update RSS after GC
              await new Promise((r) => setTimeout(r, 500));
              try {
                const { getKernelMemory } = await import('../../lib/ipc');
                const info = await getKernelMemory(kernelId);
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
    };
    setCells((prev) => {
      const next = [...prev];
      next.splice(index, 0, newCell);
      return next;
    });
    // Focus stays at same index (which is now the new cell)
  }, []);

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

  const toggleLineNumbers = useCallback(() => {
    setShowLineNumbers((prev) => !prev);
  }, []);

  // ─── Expose methods to parent via ref ───────────────────────────

  useImperativeHandle(ref, () => ({
    runCell: () => handleExecuteCell(focusedIndex),
    runAll,
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
  }), [focusedIndex, cells, kernelId, clipboard, deletedCells, handleExecuteCell, runAll, addCell, addCellAbove, deleteCell, moveCell, changeCellType, cutCell, copyCell, pasteCell, undoDelete, clearAllOutputs, toggleLineNumbers]);

  // ─── Keyboard shortcuts (command mode) ─────────────────────────
  // Matches Jupyter keyboardmanager.js including d,d / i,i / 0,0 double-press

  const lastKeyRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
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

  return (
    <div className="notebook">
      {cells.map((cell, index) => (
        <div key={cell.id} className="cell-container">
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
            <MarkdownCell
              source={cell.source}
              isFocused={index === focusedIndex}
              onChange={(src) => handleCellChange(index, src)}
              onFocus={() => setFocusedIndex(index)}
              onExecute={() => handleExecuteCell(index)}
            />
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
      ))}
    </div>
  );
});

export default Notebook;
