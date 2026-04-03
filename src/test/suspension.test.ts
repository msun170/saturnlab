import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../store/tabStore';

describe('Suspension layers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store with two tabs
    const state = useAppStore.getState();
    state.addTab({ fileName: 'second.ipynb' });
    // tab2 is now active
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('new tabs start as active', () => {
    const state = useAppStore.getState();
    for (const tab of state.tabs) {
      expect(tab.suspensionLayer).toBe('active');
    }
  });

  it('setActiveTab resets suspension to active', () => {
    const state = useAppStore.getState();
    const tab1 = state.tabs[0];

    // Manually set to layerA
    state.updateTab(tab1.id, { suspensionLayer: 'layerA' });
    expect(useAppStore.getState().tabs[0].suspensionLayer).toBe('layerA');

    // Switch to tab1
    state.setActiveTab(tab1.id);
    expect(useAppStore.getState().tabs[0].suspensionLayer).toBe('active');
  });

  it('suspensionLayer can be set to layerB', () => {
    const state = useAppStore.getState();
    const tab1 = state.tabs[0];

    state.updateTab(tab1.id, { suspensionLayer: 'layerB' });
    expect(useAppStore.getState().tabs[0].suspensionLayer).toBe('layerB');
  });

  it('suspensionLayer can be set to layerC', () => {
    const state = useAppStore.getState();
    const tab1 = state.tabs[0];

    state.updateTab(tab1.id, { suspensionLayer: 'layerC' });
    expect(useAppStore.getState().tabs[0].suspensionLayer).toBe('layerC');
  });

  it('layerC preserves notebook data', () => {
    const state = useAppStore.getState();
    const tab1 = state.tabs[0];

    // Set some notebook data
    state.updateTab(tab1.id, {
      suspensionLayer: 'layerC',
      kernelId: null,
      kernelStatus: 'disconnected',
    });

    const updated = useAppStore.getState().tabs[0];
    expect(updated.suspensionLayer).toBe('layerC');
    expect(updated.notebook).toBeTruthy();
    expect(updated.notebook.cells.length).toBeGreaterThan(0);
    expect(updated.kernelId).toBeNull();
  });
});
