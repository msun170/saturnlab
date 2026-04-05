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
import { handleCommOpen, handleCommMsg, handleCommClose, destroyKernelWidgets } from '../../lib/widgetManager';
import { buildAnalysisCode, parseDepsResult, findStaleCells, findOutOfOrderCells, type CellDeps } from '../../lib/dependencyAnalyzer';
import { explainCell, fixError } from '../../lib/ai';
import AiPanel from '../ai/AiPanel';

interface CellState {
  id: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string;
  outputs: Output[];
  execution_count: number | null;
  isRunning: boolean;
  outputHidden: boolean;
  memoryDelta: number | null;
  collapsed: boolean;
  deps: CellDeps | null;
  metadata: Record<string, unknown>;
  /** Source code at the time of last execution. Used for stale detection. */
  lastExecutedSource: string | null;
  /** Timestamp (ms) of last execution. */
  lastExecutedAt: number | null;
  /** Timestamp (ms) of last execution where the source differed from the previous run. */
  lastSourceChangeAt: number | null;
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
    deps: null,
    metadata: cell.metadata ?? {},
    lastExecutedSource: null,
    lastExecutedAt: null,
    lastSourceChangeAt: null,
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

  // Sync cells when notebook prop changes externally (e.g. Ctrl+R restore)
  const notebookCellCount = notebook.cells.length;
  const notebookFirstSource = notebook.cells[0]?.source;
  useEffect(() => {
    // Only reset if the notebook content actually changed (not from our own sync)
    const currentFirst = cells[0]?.source ?? '';
    const incomingFirst = Array.isArray(notebookFirstSource) ? notebookFirstSource.join('') : (notebookFirstSource ?? '');
    if (cells.length !== notebookCellCount || (notebookCellCount > 0 && currentFirst !== incomingFirst)) {
      setCells(notebook.cells.map(cellFromNotebook));
      setFocusedIndex(0);
    }
  }, [notebookCellCount, notebookFirstSource]);

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

  // Pointer-based drag-and-drop state
  const dragIndexRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const isDraggingRef = useRef(false);

  // Ref for analyzeDeps so the iopub listener (mount-only effect) can call the latest version
  const analyzeDepsRef = useRef<((kid: string) => void) | null>(null);

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

      if (msg_type === 'comm_open') {
        handleCommOpen(kernel_id, content as Record<string, unknown>);
        // Don't return: display_data with widget MIME follows as a separate message
      }
      if (msg_type === 'comm_msg') {
        handleCommMsg(content as Record<string, unknown>);
        return; // comm_msg doesn't produce cell output
      }
      if (msg_type === 'comm_close') {
        handleCommClose(content as Record<string, unknown>);
        return;
      }

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

        // Trigger dependency analysis after execution completes
        const kid = kernelIdRef.current;
        if (kid && pendingRef.current.size === 0) {
          // All executions done, analyze deps (use ref to get latest function)
          requestAnimationFrame(() => {
            analyzeDepsRef.current?.(kid);
          });
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      // Clean up widgets when component unmounts or kernel changes
      if (kernelIdRef.current) {
        destroyKernelWidgets(kernelIdRef.current);
      }
    };
  }, []);

  // ─── Dependency Analysis ─────────────────────────────────────────

  const analyzeDeps = useCallback(async (kid: string) => {
    // Collect source code from all code cells (read fresh from state)
    const currentCells = cells;
    const codeCells = currentCells.filter((c) => c.cell_type === 'code' && c.source.trim());
    if (codeCells.length === 0) return;

    const sources = codeCells.map((c) => c.source);
    const analysisCode = buildAnalysisCode(sources);
    const codeCount = codeCells.length;

    try {
      const msgId = crypto.randomUUID();
      const { listen: listenOnce } = await import('@tauri-apps/api/event');
      let resultText = '';

      const unlisten = await listenOnce<{ msg_type: string; content: Record<string, unknown>; parent_msg_id: string; kernel_id: string }>('kernel-output', (event) => {
        if (event.payload.parent_msg_id !== msgId) return;
        if (event.payload.msg_type === 'stream') {
          resultText += (event.payload.content.text as string) ?? '';
        }
        if (event.payload.msg_type === 'status' && event.payload.content.execution_state === 'idle') {
          unlisten();
          const depsArray = parseDepsResult(resultText);
          if (depsArray && depsArray.length === codeCount) {
            setCells((prev) => {
              let codeIdx = 0;
              return prev.map((cell) => {
                if (cell.cell_type === 'code' && cell.source.trim()) {
                  const deps = depsArray[codeIdx] ?? null;
                  codeIdx++;
                  return { ...cell, deps };
                }
                return { ...cell, deps: null };
              });
            });
          }
        }
      });

      await executeCode(kid, analysisCode, true, msgId);
    } catch {
      // Silently fail -- deps analysis is optional
    }
  }, [cells]);
  analyzeDepsRef.current = analyzeDeps;

  // Compute stale and out-of-order cells from deps
  const staleCells = useMemo(() => {
    const cellData = cells.map((c) => ({
      deps: c.deps,
      source: c.source,
      lastExecutedSource: c.lastExecutedSource,
      lastExecutedAt: c.lastExecutedAt,
      lastSourceChangeAt: c.lastSourceChangeAt,
    }));
    return findStaleCells(cellData);
  }, [cells]);

  const outOfOrderCells = useMemo(() => {
    const cellData = cells.map((c) => ({ deps: c.deps }));
    return findOutOfOrderCells(cellData);
  }, [cells]);

  // Sync cells back to notebook format when they change
  useEffect(() => {
    const updatedNotebook: NotebookType = {
      ...notebook,
      cells: cells.map((cell) => ({
        cell_type: cell.cell_type,
        source: cell.source,
        metadata: cell.metadata,
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

      // Clear outputs, mark as running, track execution timestamps
      const now = Date.now();
      setCells((prev) =>
        prev.map((c, i) => {
          if (i !== index) return c;
          // If source changed since last execution, record the change timestamp
          const sourceChanged = c.lastExecutedSource !== null && c.source !== c.lastExecutedSource;
          return {
            ...c,
            outputs: [],
            isRunning: true,
            lastExecutedSource: c.source,
            lastExecutedAt: now,
            lastSourceChangeAt: sourceChanged ? now : c.lastSourceChangeAt,
          };
        }),
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
    pushUndo();
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
      deps: null,
      metadata: {},
      lastExecutedSource: null,
      lastExecutedAt: null,
      lastSourceChangeAt: null,
    };
    setCells((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, newCell);
      return next;
    });
    setFocusedIndex(index + 1);
  }, []);

  // Full undo stack: saves entire cells array before each cell operation
  const cellHistoryRef = useRef<CellState[][]>([]);
  const MAX_UNDO = 50;

  const pushUndo = useCallback(() => {
    cellHistoryRef.current = [...cellHistoryRef.current.slice(-(MAX_UNDO - 1)), [...cells]];
  }, [cells]);

  const deleteCell = useCallback(
    (index: number) => {
      if (cells.length <= 1) return;
      pushUndo();
      setCells((prev) => prev.filter((_, i) => i !== index));
      setFocusedIndex(Math.min(index, cells.length - 2));
    },
    [cells, pushUndo],
  );

  const moveCell = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= cells.length) return;
      pushUndo();
      setCells((prev) => {
        const next = [...prev];
        [next[index], next[newIndex]] = [next[newIndex], next[index]];
        return next;
      });
      setFocusedIndex(newIndex);
    },
    [cells.length],
  );

  // ─── Pointer-based drag-and-drop cell reordering ────────────────

  const handlePointerDragStart = useCallback((e: React.PointerEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragIndexRef.current = index;
    dragOverRef.current = null;
    isDraggingRef.current = true;

    // Dim the source cell
    const sourceEl = document.querySelector(`[data-cell-index="${index}"]`) as HTMLElement | null;
    if (sourceEl) sourceEl.style.opacity = '0.4';

    const handlePointerMove = (moveEvt: PointerEvent) => {
      if (!isDraggingRef.current) return;

      // Find which cell-container the pointer is over
      const el = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
      if (!el) return;
      const container = (el as HTMLElement).closest('[data-cell-index]') as HTMLElement | null;
      if (container) {
        const overIndex = parseInt(container.dataset.cellIndex ?? '', 10);
        if (!isNaN(overIndex) && overIndex !== dragIndexRef.current) {
          dragOverRef.current = overIndex;
          setDragOverIndex(overIndex);
        }
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      // Restore opacity
      if (sourceEl) sourceEl.style.opacity = '1';

      const sourceIndex = dragIndexRef.current;
      const targetIndex = dragOverRef.current;

      isDraggingRef.current = false;
      dragIndexRef.current = null;
      dragOverRef.current = null;
      setDragOverIndex(null);

      // Perform the reorder
      if (sourceIndex !== null && targetIndex !== null && sourceIndex !== targetIndex) {
        pushUndo();
        setCells((prev) => {
          const next = [...prev];
          const [moved] = next.splice(sourceIndex, 1);
          // When dragging down, removing the source shifts later indices by -1
          const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
          next.splice(adjustedTarget, 0, moved);
          return next;
        });
        const newFocused = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        setFocusedIndex(newFocused);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [pushUndo]);

  const addCellAbove = useCallback((index: number, type: 'code' | 'markdown') => {
    pushUndo();
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
      deps: null,
      metadata: {},
      lastExecutedSource: null,
      lastExecutedAt: null,
      lastSourceChangeAt: null,
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
    pushUndo();
    setCells((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, cell_type: newType, outputs: [], execution_count: null } : c,
      ),
    );
  }, []);

  // ─── Clipboard ─────────────────────────────────────────────────

  const [clipboard, setClipboard] = useState<CellState | null>(null);

  const cutCell = useCallback(
    (index: number) => {
      if (cells.length <= 1) return;
      pushUndo();
      const cell = cells[index];
      setClipboard(cell);
      setCells((prev) => prev.filter((_, i) => i !== index));
      setFocusedIndex(Math.min(index, cells.length - 2));
    },
    [cells, pushUndo],
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
      pushUndo();
      const pasted = { ...clipboard, id: generateCellId() };
      setCells((prev) => {
        const next = [...prev];
        next.splice(index + 1, 0, pasted);
        return next;
      });
      setFocusedIndex(index + 1);
    },
    [clipboard, pushUndo],
  );

  const undoDelete = useCallback(() => {
    if (cellHistoryRef.current.length === 0) return;
    const previousCells = cellHistoryRef.current.pop()!;
    setCells(previousCells);
  }, []);

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

  // AI state
  const [aiCellIndex, setAiCellIndex] = useState<number | null>(null);
  const [aiType, setAiType] = useState<'explain' | 'fix' | 'generate'>('explain');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const handleAiExplain = useCallback(async (index: number) => {
    const cell = cells[index];
    if (!cell || !cell.source.trim()) return;
    setAiCellIndex(index);
    setAiType('explain');
    setAiResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const result = await explainCell(cell.source);
      setAiResult(result);
    } catch (e: unknown) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }, [cells]);

  const handleAiFix = useCallback(async (index: number) => {
    const cell = cells[index];
    if (!cell) return;
    const errorOutput = cell.outputs.find((o) => o.output_type === 'error');
    if (!errorOutput) return;
    const traceback = (errorOutput.traceback ?? []).join('\n');
    setAiCellIndex(index);
    setAiType('fix');
    setAiResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const result = await fixError(cell.source, traceback);
      setAiResult(result);
    } catch (e: unknown) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }, [cells]);

  const handleAiApply = useCallback((code: string) => {
    if (aiCellIndex === null) return;
    handleCellChange(aiCellIndex, code);
  }, [aiCellIndex]);

  const handleAiDismiss = useCallback(() => {
    setAiCellIndex(null);
    setAiResult(null);
    setAiError(null);
    setAiLoading(false);
  }, []);

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
  }), [focusedIndex, cells, kernelId, clipboard, handleExecuteCell, runAll, runCellRange, addCell, addCellAbove, deleteCell, moveCell, changeCellType, cutCell, copyCell, pasteCell, undoDelete, clearAllOutputs, toggleLineNumbers]);

  // ─── Keyboard shortcuts (command mode) ─────────────────────────
  // Matches Jupyter keyboardmanager.js including d,d / i,i / 0,0 double-press

  const lastKeyRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;

      // When inside an editor, let all Ctrl+ shortcuts through to the editor
      if (target.closest('.cm-editor') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        return;
      }

      // Ctrl+Z/X/C/V in command mode: cell operations
      // But only if no text is selected (allow normal copy/paste of selected text)
      const hasTextSelection = (window.getSelection()?.toString().length ?? 0) > 0;
      if ((e.ctrlKey || e.metaKey) && ['z', 'x', 'c', 'v'].includes(e.key) && !hasTextSelection) {
        e.preventDefault();
        if (e.key === 'z') undoDelete();
        else if (e.key === 'x') cutCell(focusedIndex);
        else if (e.key === 'c') copyCell(focusedIndex);
        else if (e.key === 'v') pasteCell(focusedIndex);
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
        // x, c, v, z handled via Ctrl+ above (not bare keys)
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          deleteCell(focusedIndex);
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
          data-cell-index={index}
          className={`cell-container ${index === focusedIndex ? 'cell-focused-container' : ''} ${index === highlightCellIndex ? 'cell-highlighted' : ''} ${dragOverIndex === index ? 'cell-drag-over' : ''} ${staleCells.has(index) ? 'cell-stale' : ''} ${outOfOrderCells.has(index) ? 'cell-out-of-order' : ''}`}
        >
          {/* Drag handle (pointer-based, not HTML5 drag) */}
          <div
            className="cell-drag-handle"
            onPointerDown={(e) => handlePointerDragStart(e, index)}
            title="Drag to reorder"
          >
            &#x2630;
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
            {cell.cell_type === 'code' && (
              <>
                <button className="cell-ai-btn" onClick={() => handleAiExplain(index)} title="Explain with AI">
                  ?
                </button>
                {cell.outputs.some((o) => o.output_type === 'error') && (
                  <button className="cell-ai-btn" onClick={() => handleAiFix(index)} title="Fix error with AI">
                    fix
                  </button>
                )}
              </>
            )}
          </div>

          {/* AI Panel (shown below cell actions, above cell content) */}
          {aiCellIndex === index && (
            <AiPanel
              type={aiType}
              result={aiResult}
              loading={aiLoading}
              error={aiError}
              onApply={aiType !== 'explain' ? handleAiApply : undefined}
              onDismiss={handleAiDismiss}
            />
          )}

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

          {/* Stale / out-of-order indicators */}
          {staleCells.has(index) && (
            <div className="cell-stale-badge" title="This cell may be stale. A variable it uses was redefined by a more recently executed cell.">
              {'\u25CC'} stale - inputs changed since last run
            </div>
          )}
          {outOfOrderCells.has(index) && !staleCells.has(index) && (
            <div className="cell-order-badge" title="This cell uses a variable defined in a cell below it. Consider reordering.">
              {'\u26A0'} uses variable defined below
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
