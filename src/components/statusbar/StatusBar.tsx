import { useMemo } from 'react';
import { useAppStore } from '../../store';
import { formatBytes } from '../../types/memory';
import MemoryBar from './MemoryBar';

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const lastAutosaveTime = useAppStore((s) => s.lastAutosaveTime);
  const tab = tabs.find((t) => t.id === activeTabId);

  if (!tab) return null;

  const kernelName = tab.notebook.metadata.kernelspec?.display_name ?? 'No Kernel';

  const outputStats = useMemo(() => {
    let totalBytes = 0;
    let imageCount = 0;
    let largestCellBytes = 0;
    let largestCellIndex = -1;

    for (let i = 0; i < tab.notebook.cells.length; i++) {
      const cell = tab.notebook.cells[i];
      if (!cell.outputs) continue;
      let cellBytes = 0;
      for (const output of cell.outputs) {
        const json = JSON.stringify(output);
        cellBytes += json.length;
        const data = output.data as Record<string, unknown> | undefined;
        if (data?.['image/png'] || data?.['image/jpeg']) imageCount++;
      }
      totalBytes += cellBytes;
      if (cellBytes > largestCellBytes) {
        largestCellBytes = cellBytes;
        largestCellIndex = i;
      }
    }

    return { totalBytes, imageCount, largestCellBytes, largestCellIndex };
  }, [tab.notebook.cells]);

  const handleOutputClick = () => {
    if (outputStats.largestCellIndex < 0) return;
    const store = useAppStore.getState();
    if (tab) {
      store.updateTab(tab.id, { highlightCellIndex: outputStats.largestCellIndex });
    }
    // Scroll to the cell
    const cells = document.querySelectorAll('.cell-container');
    if (cells[outputStats.largestCellIndex]) {
      cells[outputStats.largestCellIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className="status-bar-item">
          <span className={`status-bar-dot ${tab.kernelStatus}`} />
          <span>{kernelName}</span>
          <span className="status-bar-separator">|</span>
          <span>{tab.kernelStatus}</span>
        </div>
        <MemoryBar />
      </div>

      <div className="status-bar-center">
        {lastAutosaveTime ? (
          <div className="status-bar-item status-bar-autosave">
            Autosaved at {lastAutosaveTime}
          </div>
        ) : (
          <div className="status-bar-item">
            {tab.editMode ? 'Edit' : 'Command'}
          </div>
        )}
      </div>

      <div className="status-bar-right">
        {outputStats.totalBytes > 0 && (
          <div
            className="status-bar-item status-bar-outputs"
            onClick={handleOutputClick}
            title={`Click to go to heaviest cell (cell ${outputStats.largestCellIndex + 1}: ${formatBytes(outputStats.largestCellBytes)}, ${outputStats.imageCount} images total)`}
          >
            Out: {formatBytes(outputStats.totalBytes)}
          </div>
        )}
        {tab.isDirty && (
          <div className="status-bar-item status-bar-dirty">Unsaved</div>
        )}
        <div className="status-bar-item status-bar-filename">
          {tab.filePath ?? 'Untitled'}
        </div>
      </div>
    </div>
  );
}
