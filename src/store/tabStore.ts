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
  kernelSpecName: string | null;
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
  /** True when this tab shows the Launcher instead of a notebook. */
  isLauncher: boolean;
  /** True when this tab shows an integrated terminal. */
  isTerminal: boolean;
  /** True when this tab shows a plain text editor. */
  isTextEditor: boolean;
  /** Text content for plain text editor tabs. */
  textContent: string;
  /** Cell index to highlight (e.g. heaviest output cell). null = no highlight. */
  highlightCellIndex: number | null;
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
    kernelSpecName: null,
    kernelStatus: 'disconnected',
    suspensionLayer: 'active',
    lastActiveAt: Date.now(),
    scrollPosition: 0,
    focusedCellIndex: 0,
    editMode: false,
    isDirty: false,
    focusedCellType: 'code',
    pendingExecutions: new Map(),
    isLauncher: false,
    isTerminal: false,
    isTextEditor: false,
    textContent: '',
    highlightCellIndex: null,
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
  lastAutosaveTime: string | null;
  appSettings: {
    kernel_auto_stop_minutes: number | null;
    layer_b_delay_seconds: number;
    layer_a_delay_seconds: number;
    autosave_interval_seconds: number;
    show_line_numbers: boolean;
    theme: string;
    editor_font_size: number;
    ai_provider: string;
    ai_api_key: string;
    ai_base_url: string;
    ai_model: string;
    remote_server_url: string;
    remote_token: string;
  };

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
  setLastAutosaveTime: (time: string | null) => void;
  setAppSettings: (settings: AppStore['appSettings']) => void;
}

const initialTab = createDefaultTab({ fileName: 'Launcher', isLauncher: true });

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state: one empty tab, active
  tabs: [initialTab],
  activeTabId: initialTab.id,

  kernelspecs: [],
  error: null,
  showShortcuts: false,
  lastAutosaveTime: null,
  appSettings: {
    kernel_auto_stop_minutes: null,
    layer_b_delay_seconds: 30,
    layer_a_delay_seconds: 300,
    autosave_interval_seconds: 30,
    show_line_numbers: true,
    theme: 'light',
    editor_font_size: 14,
    ai_provider: 'none',
    ai_api_key: '',
    ai_base_url: '',
    ai_model: '',
    remote_server_url: '',
    remote_token: '',
  },

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
        // Never have zero tabs, open a launcher
        const newTab = createDefaultTab({ fileName: 'Launcher', isLauncher: true });
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
  setLastAutosaveTime: (time) => set({ lastAutosaveTime: time }),
  setAppSettings: (settings) => set({ appSettings: settings }),
}));

// Persist open tab info to localStorage for Ctrl+R reload recovery
useAppStore.subscribe((state) => {
  const tabInfo = state.tabs
    .filter((t) => t.filePath && !t.isLauncher && !t.isTerminal)
    .map((t) => ({
      filePath: t.filePath,
      fileName: t.fileName,
      isTextEditor: t.isTextEditor,
    }));
  const activeFilePath = state.tabs.find((t) => t.id === state.activeTabId)?.filePath ?? null;
  localStorage.setItem('saturn-open-tabs', JSON.stringify({ tabInfo, activeFilePath }));
});

// On startup, restore tabs from localStorage
try {
  const saved = localStorage.getItem('saturn-open-tabs');
  if (saved) {
    const { tabInfo, activeFilePath } = JSON.parse(saved) as {
      tabInfo: { filePath: string; fileName: string; isTextEditor?: boolean }[];
      activeFilePath: string | null;
    };
    if (tabInfo.length > 0) {
      // Replace the initial launcher tab with saved tabs
      // Notebooks will be loaded async in App.tsx, text files likewise
      const restoredTabs = tabInfo.map((info) =>
        createDefaultTab({
          filePath: info.filePath,
          fileName: info.fileName,
          isTextEditor: info.isTextEditor ?? false,
        }),
      );
      const activeTab = activeFilePath
        ? restoredTabs.find((t) => t.filePath === activeFilePath)
        : restoredTabs[0];
      useAppStore.setState({
        tabs: restoredTabs,
        activeTabId: activeTab?.id ?? restoredTabs[0].id,
      });
    }
  }
} catch { /* ignore localStorage errors */ }
