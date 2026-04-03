import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';

const AUTOSAVE_INTERVAL = 30_000; // 30 seconds

/**
 * Auto-saves dirty notebooks every 30 seconds.
 * Only saves tabs that have a filePath (not untitled).
 * Call this once in App.tsx.
 */
export function useAutosave() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      const state = useAppStore.getState();

      for (const tab of state.tabs) {
        if (!tab.isDirty || !tab.filePath || tab.isLauncher) continue;

        try {
          const { writeNotebook } = await import('../lib/ipc');
          await writeNotebook(tab.filePath, tab.notebook);
          state.updateTab(tab.id, { isDirty: false });
        } catch {
          // Silent fail on autosave, don't interrupt user
        }
      }
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
