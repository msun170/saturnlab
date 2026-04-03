import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/tabStore';

describe('tabStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    const initialTab = useAppStore.getState().tabs[0];
    useAppStore.setState({
      tabs: [initialTab],
      activeTabId: initialTab.id,
      kernelspecs: [],
      error: null,
      showShortcuts: false,
    });
  });

  it('starts with one tab', () => {
    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.activeTabId).toBeTruthy();
  });

  it('first tab has default values', () => {
    const tab = useAppStore.getState().tabs[0];
    expect(tab.filePath).toBeNull();
    expect(tab.fileName).toBe('Launcher');
    expect(tab.kernelId).toBeNull();
    expect(tab.kernelStatus).toBe('disconnected');
    expect(tab.suspensionLayer).toBe('active');
    expect(tab.isDirty).toBe(false);
    expect(tab.notebook.nbformat).toBe(4);
    expect(tab.notebook.cells.length).toBe(1);
  });

  it('addTab creates a new tab and makes it active', () => {
    const { addTab } = useAppStore.getState();
    const newId = addTab({ fileName: 'test.ipynb' });

    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(2);
    expect(state.activeTabId).toBe(newId);
    expect(state.tabs.find((t) => t.id === newId)?.fileName).toBe('test.ipynb');
  });

  it('removeTab removes a tab', () => {
    const { addTab, removeTab } = useAppStore.getState();
    const id1 = useAppStore.getState().tabs[0].id;
    addTab({ fileName: 'second.ipynb' });

    removeTab(id1);
    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].fileName).toBe('second.ipynb');
  });

  it('removeTab on last tab creates a new empty tab', () => {
    const id = useAppStore.getState().tabs[0].id;
    useAppStore.getState().removeTab(id);

    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].fileName).toBe('Untitled.ipynb');
    expect(state.activeTabId).toBeTruthy();
  });

  it('removeTab activates adjacent tab when active is removed', () => {
    const { addTab, removeTab } = useAppStore.getState();
    addTab({ fileName: 'second.ipynb' });
    const id3 = addTab({ fileName: 'third.ipynb' });

    // Active is id3 (last added). Remove it.
    removeTab(id3);
    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(2);
    expect(state.activeTabId).not.toBe(id3);
  });

  it('setActiveTab changes the active tab', () => {
    const id1 = useAppStore.getState().tabs[0].id;
    useAppStore.getState().addTab({ fileName: 'other.ipynb' });

    useAppStore.getState().setActiveTab(id1);
    expect(useAppStore.getState().activeTabId).toBe(id1);
  });

  it('setActiveTab resets suspension to active', () => {
    const { addTab, updateTab, setActiveTab } = useAppStore.getState();
    const id1 = useAppStore.getState().tabs[0].id;
    addTab();

    // Simulate suspension on id1
    updateTab(id1, { suspensionLayer: 'layerA' });

    // Switch back to id1
    setActiveTab(id1);
    const tab = useAppStore.getState().tabs.find((t) => t.id === id1);
    expect(tab?.suspensionLayer).toBe('active');
  });

  it('updateTab merges partial state', () => {
    const id = useAppStore.getState().tabs[0].id;
    useAppStore.getState().updateTab(id, {
      kernelId: 'kernel-123',
      kernelStatus: 'idle',
      isDirty: true,
    });

    const tab = useAppStore.getState().tabs.find((t) => t.id === id);
    expect(tab?.kernelId).toBe('kernel-123');
    expect(tab?.kernelStatus).toBe('idle');
    expect(tab?.isDirty).toBe(true);
    // Other fields unchanged
    expect(tab?.fileName).toBe('Untitled.ipynb');
  });

  it('getActiveTab returns the correct tab', () => {
    const tab = useAppStore.getState().getActiveTab();
    expect(tab).toBeTruthy();
    expect(tab?.id).toBe(useAppStore.getState().activeTabId);
  });

  it('setKernelspecs stores kernel specs', () => {
    useAppStore.getState().setKernelspecs([
      { name: 'python3', display_name: 'Python 3', language: 'python', argv: [] },
    ]);
    expect(useAppStore.getState().kernelspecs.length).toBe(1);
    expect(useAppStore.getState().kernelspecs[0].name).toBe('python3');
  });

  it('setError and setShowShortcuts work', () => {
    useAppStore.getState().setError('test error');
    expect(useAppStore.getState().error).toBe('test error');

    useAppStore.getState().setShowShortcuts(true);
    expect(useAppStore.getState().showShortcuts).toBe(true);
  });

  it('pendingExecutions map survives updates', () => {
    const id = useAppStore.getState().tabs[0].id;
    const tab = useAppStore.getState().tabs.find((t) => t.id === id)!;

    // Simulate setting a pending execution
    tab.pendingExecutions.set('msg-1', 'cell-1');
    expect(tab.pendingExecutions.get('msg-1')).toBe('cell-1');

    // Update tab with other fields
    useAppStore.getState().updateTab(id, { isDirty: true });

    // pendingExecutions should still be there
    const updated = useAppStore.getState().tabs.find((t) => t.id === id)!;
    expect(updated.pendingExecutions.get('msg-1')).toBe('cell-1');
  });

  it('multiple tabs have independent state', () => {
    const id1 = useAppStore.getState().tabs[0].id;
    const id2 = useAppStore.getState().addTab({ fileName: 'second.ipynb' });

    useAppStore.getState().updateTab(id1, { kernelId: 'k1', isDirty: true });
    useAppStore.getState().updateTab(id2, { kernelId: 'k2', isDirty: false });

    const tabs = useAppStore.getState().tabs;
    const t1 = tabs.find((t) => t.id === id1)!;
    const t2 = tabs.find((t) => t.id === id2)!;

    expect(t1.kernelId).toBe('k1');
    expect(t1.isDirty).toBe(true);
    expect(t2.kernelId).toBe('k2');
    expect(t2.isDirty).toBe(false);
  });
});
