import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { listen } from '@tauri-apps/api/event';
import CodeCell from './CodeCell';
import MarkdownCell from './MarkdownCell';
import OutputArea from '../output/OutputArea';
import type { Cell, Output, Notebook as NotebookType } from '../../types/notebook';
import type { KernelOutput } from '../../types/kernel';
import { executeCode } from '../../lib/ipc';

interface CellState {
  id: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string;
  outputs: Output[];
  execution_count: number | null;
  isRunning: boolean;
}

interface NotebookProps {
  notebook: NotebookType;
  kernelId: string | null;
  onNotebookChange: (notebook: NotebookType) => void;
  onFocusedCellChange?: (cellType: string, index: number) => void;
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
  };
}

/** Methods exposed to parent via ref for toolbar integration. */
export interface NotebookHandle {
  runCell: () => void;
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
  interruptKernel: () => void;
}

const Notebook = forwardRef<NotebookHandle, NotebookProps>(function Notebook({ notebook, kernelId, onNotebookChange, onFocusedCellChange }, ref) {
  const [cells, setCells] = useState<CellState[]>(() =>
    notebook.cells.map(cellFromNotebook),
  );
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [editMode, setEditMode] = useState(false); // false = command mode, true = edit mode

  // Notify parent of focused cell changes (for toolbar cell type dropdown)
  useEffect(() => {
    const cell = cells[focusedIndex];
    if (cell && onFocusedCellChange) {
      onFocusedCellChange(cell.cell_type, focusedIndex);
    }
  }, [focusedIndex, cells, onFocusedCellChange]);

  // Track which msg_id belongs to which cell
  const [_pendingExecutions, setPendingExecutions] = useState<Map<string, string>>(new Map());

  // Listen for kernel output events and route to the correct cell
  useEffect(() => {
    const unlisten = listen<KernelOutput>('kernel-output', (event) => {
      const { msg_type, content, parent_msg_id } = event.payload;

      // Find which cell this output belongs to
      setPendingExecutions((prev) => {
        const cellId = prev.get(parent_msg_id);
        if (!cellId) return prev;

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
              case 'execute_reply': {
                // Shell reply — contains execution_count
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

        // Clean up pending execution when done
        if (msg_type === 'status' && content.execution_state === 'idle') {
          const next = new Map(prev);
          next.delete(parent_msg_id);
          return next;
        }
        return prev;
      });
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
        const msgId = await executeCode(kernelId, cell.source);
        setPendingExecutions((prev) => new Map(prev).set(msgId, cell.id));
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
  }, []);

  // ─── Cell Operations ───────────────────────────────────────────

  const addCell = useCallback((index: number, type: 'code' | 'markdown') => {
    const newCell: CellState = {
      id: generateCellId(),
      cell_type: type,
      source: '',
      outputs: [],
      execution_count: null,
      isRunning: false,
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

  // ─── Expose methods to parent via ref ───────────────────────────

  useImperativeHandle(ref, () => ({
    runCell: () => handleExecuteCell(focusedIndex),
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
    interruptKernel: () => {
      if (kernelId) {
        import('../../lib/ipc').then(({ interruptKernel }) => interruptKernel(kernelId));
      }
    },
  }), [focusedIndex, cells, kernelId, clipboard, deletedCells, handleExecuteCell, addCell, addCellAbove, deleteCell, moveCell, changeCellType, cutCell, copyCell, pasteCell, undoDelete]);

  // ─── Keyboard shortcuts (command mode) ─────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only handle if not inside an editor
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        return;
      }

      // Matching Jupyter's exact command mode shortcuts from keyboardmanager.js
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          setEditMode(true);
          break;
        case 'Escape':
          e.preventDefault();
          setEditMode(false);
          break;
        // Cell insertion
        case 'a':
          e.preventDefault();
          addCellAbove(focusedIndex, 'code');
          break;
        case 'b':
          e.preventDefault();
          addCell(focusedIndex, 'code');
          break;
        // Navigation
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
        // Cell type
        case 'm':
          e.preventDefault();
          changeCellType(focusedIndex, 'markdown');
          break;
        case 'y':
          e.preventDefault();
          changeCellType(focusedIndex, 'code');
          break;
        // Clipboard
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
        // Save
        case 's':
          e.preventDefault();
          // Handled at App level via Ctrl+S
          break;
        // Toggle line numbers
        case 'l':
          e.preventDefault();
          // TODO: toggle line numbers on focused cell
          break;
        // Toggle output
        case 'o':
          e.preventDefault();
          // TODO: toggle cell output collapsed
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, cells.length, addCell, addCellAbove, changeCellType, cutCell, copyCell, pasteCell, undoDelete, deleteCell]);

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
                onChange={(src) => handleCellChange(index, src)}
                onExecute={() => handleExecuteCell(index)}
                onFocus={() => { setFocusedIndex(index); setEditMode(true); }}
              />
              <OutputArea outputs={cell.outputs} />
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
