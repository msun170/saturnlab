import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import type { SuspensionLayer } from '../store';

// Read delays from the store (updated when settings are saved)
function getDelays() {
  const s = useAppStore.getState().appSettings;
  return {
    layerB: s.layer_b_delay_seconds * 1000,
    layerA: s.layer_a_delay_seconds * 1000,
    layerCEnabled: s.kernel_auto_stop_minutes !== null,
    layerC: (s.kernel_auto_stop_minutes ?? 30) * 60 * 1000,
  };
}

interface TabTimers {
  layerB: ReturnType<typeof setTimeout> | null;
  layerA: ReturnType<typeof setTimeout> | null;
  layerC: ReturnType<typeof setTimeout> | null;
}

/**
 * Manages suspension timers for inactive tabs.
 * Escalates: active -> layerB (30s) -> layerA (5min) -> layerC (30min)
 * Call this once in App.tsx.
 */
export function useSuspension() {
  const timers = useRef<Map<string, TabTimers>>(new Map());
  const prevActiveTabId = useRef<string | null>(null);

  useEffect(() => {
    // Subscribe to activeTabId changes
    const unsub = useAppStore.subscribe((state, prevState) => {
      if (state.activeTabId === prevState.activeTabId) return;

      const prevId = prevState.activeTabId;
      const newId = state.activeTabId;

      // Resume the newly active tab
      if (newId) {
        clearTimersForTab(newId);
        const tab = state.tabs.find((t) => t.id === newId);
        if (tab && tab.suspensionLayer !== 'active') {
          useAppStore.getState().updateTab(newId, {
            suspensionLayer: 'active',
            lastActiveAt: Date.now(),
          });
        }
      }

      // Start suspension timers for the previously active tab
      if (prevId && prevId !== newId) {
        startTimersForTab(prevId);
      }

      prevActiveTabId.current = newId;
    });

    return () => {
      unsub();
      // Clear all timers on unmount
      for (const [, t] of timers.current) {
        if (t.layerB) clearTimeout(t.layerB);
        if (t.layerA) clearTimeout(t.layerA);
        if (t.layerC) clearTimeout(t.layerC);
      }
    };
  }, []);

  function clearTimersForTab(tabId: string) {
    const t = timers.current.get(tabId);
    if (t) {
      if (t.layerB) clearTimeout(t.layerB);
      if (t.layerA) clearTimeout(t.layerA);
      if (t.layerC) clearTimeout(t.layerC);
      timers.current.delete(tabId);
    }
  }

  function startTimersForTab(tabId: string) {
    clearTimersForTab(tabId);
    const delays = getDelays();

    const tabTimers: TabTimers = {
      layerB: setTimeout(() => {
        setSuspension(tabId, 'layerB');
      }, delays.layerB),

      layerA: setTimeout(() => {
        setSuspension(tabId, 'layerA');
      }, delays.layerA),

      layerC: delays.layerCEnabled ? setTimeout(() => {
        setSuspension(tabId, 'layerC');
        const store = useAppStore.getState();
        const tab = store.tabs.find((t) => t.id === tabId);
        if (tab?.kernelId) {
          import('../lib/ipc').then(({ stopKernel }) => {
            stopKernel(tab.kernelId!);
            store.updateTab(tabId, {
              kernelId: null,
              kernelStatus: 'disconnected',
            });
          });
        }
      }, delays.layerC) : null,
    };

    timers.current.set(tabId, tabTimers);
  }

  function setSuspension(tabId: string, layer: SuspensionLayer) {
    const store = useAppStore.getState();
    // Only escalate, never downgrade (active tab handles that)
    const tab = store.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.id === store.activeTabId) return; // don't suspend active tab

    const layerOrder: SuspensionLayer[] = ['active', 'layerB', 'layerA', 'layerC'];
    const currentIdx = layerOrder.indexOf(tab.suspensionLayer);
    const newIdx = layerOrder.indexOf(layer);
    if (newIdx > currentIdx) {
      store.updateTab(tabId, { suspensionLayer: layer });
    }
  }
}
