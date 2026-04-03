import { create } from 'zustand';
import type { Notebook } from '../types/notebook';
import type { KernelSpec } from '../types/kernel';

export type KernelStatus = 'disconnected' | 'starting' | 'idle' | 'busy';
export type SuspensionLayer = 'active' | 'layerB' | 'layerA' | 'layerC';

export interface TabState {
  id: string;
  filePath: string | null;
  fileName: string;
  notebook: Notebook;
  kernelId: string | null;
  kernelStatus: KernelStatus;
  suspensionLayer: SuspensionLayer;
  lastActiveAt: number;
  scrollPosition: number;
  focusedCellIndex: number;
  editMode: boolean;
  isDirty: boolean;
  focusedCellType: string;
  /** Non-reactive map: msg_id -> cell_id. Survives tab switches. */
  pendingExecutions: Map<string, string>;
}

function createEmptyNotebook(): Notebook {
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

let tabCounter = 0;

function createDefaultTab(overrides?: Partial<TabState>): TabState {
  tabCounter++;
  return {
    id: `tab-${Date.now()}-${tabCounter}`,
    filePath: null,
    fileName: 'Untitled.ipynb',
    notebook: createEmptyNotebook(),
    kernelId: null,
    kernelStatus: 'disconnected',
    suspensionLayer: 'active',
    lastActiveAt: Date.now(),
    scrollPosition: 0,
    focusedCellIndex: 0,
    editMode: false,
    isDirty: false,
    focusedCellType: 'code',
    pendingExecutions: new Map(),
    ...overrides,
  };
}

interface AppStore {
  // Tab state
  tabs: TabState[];
  activeTabId: string | null;

  // Global state
  kernelspecs: KernelSpec[];
  error: string | null;
  showShortcuts: boolean;

  // Tab actions
  addTab: (overrides?: Partial<TabState>) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<TabState>) => void;
  getActiveTab: () => TabState | undefined;

  // Global actions
  setKernelspecs: (specs: KernelSpec[]) => void;
  setError: (error: string | null) => void;
  setShowShortcuts: (show: boolean) => void;
}

const initialTab = createDefaultTab();

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state: one empty tab, active
  tabs: [initialTab],
  activeTabId: initialTab.id,

  kernelspecs: [],
  error: null,
  showShortcuts: false,

  addTab: (overrides) => {
    const tab = createDefaultTab(overrides);
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  removeTab: (id) => {
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        // Never have zero tabs, create a new empty one
        const newTab = createDefaultTab();
        return {
          tabs: [newTab],
          activeTabId: newTab.id,
        };
      }
      // If we removed the active tab, activate the previous or next
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        const removedIndex = state.tabs.findIndex((t) => t.id === id);
        const newIndex = Math.min(removedIndex, remaining.length - 1);
        newActiveId = remaining[newIndex].id;
      }
      return { tabs: remaining, activeTabId: newActiveId };
    });
  },

  setActiveTab: (id) => {
    set((state) => ({
      activeTabId: id,
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, lastActiveAt: Date.now(), suspensionLayer: 'active' as SuspensionLayer }
          : t,
      ),
    }));
  },

  updateTab: (id, patch) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  },

  getActiveTab: () => {
    const state = get();
    return state.tabs.find((t) => t.id === state.activeTabId);
  },

  setKernelspecs: (specs) => set({ kernelspecs: specs }),
  setError: (error) => set({ error }),
  setShowShortcuts: (show) => set({ showShortcuts: show }),
}));
