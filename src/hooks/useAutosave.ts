import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';

const AUTOSAVE_INTERVAL = 30_000; // 30 seconds

/**
 * Auto-saves dirty notebooks every 30 seconds.
 * Only saves tabs that have a filePath (not untitled).
 * Updates lastAutosaveTime in store for status bar display.
 */
export function useAutosave() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      const state = useAppStore.getState();
      let saved = false;

      for (const tab of state.tabs) {
        if (!tab.isDirty || !tab.filePath || tab.isLauncher) continue;

        try {
          const { writeNotebook } = await import('../lib/ipc');
          await writeNotebook(tab.filePath, tab.notebook);
          state.updateTab(tab.id, { isDirty: false });
          saved = true;
        } catch {
          // Silent fail on autosave
        }
      }

      if (saved) {
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        state.setLastAutosaveTime(time);
        // Clear the message after 10 seconds
        setTimeout(() => {
          useAppStore.getState().setLastAutosaveTime(null);
        }, 10_000);
      }
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
