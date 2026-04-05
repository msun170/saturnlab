import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';

/**
 * Auto-saves dirty notebooks at the interval configured in settings.
 * Reads interval from appSettings in the store (updated when settings are saved).
 */
export function useAutosave() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-subscribe when settings change
  const intervalMs = useAppStore((s) => s.appSettings.autosave_interval_seconds) * 1000;

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(async () => {
      const state = useAppStore.getState();
      let saved = false;

      for (const tab of state.tabs) {
        if (!tab.isDirty || !tab.filePath || tab.isLauncher || tab.isTerminal) continue;

        try {
          if (tab.isTextEditor) {
            // Text editor tabs: save as plain text
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('write_text_file', { path: tab.filePath, content: tab.textContent });
          } else {
            // Notebook tabs: save as .ipynb
            const { writeNotebook } = await import('../lib/ipc');
            await writeNotebook(tab.filePath, tab.notebook);
          }
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
    }, intervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [intervalMs]);
}
