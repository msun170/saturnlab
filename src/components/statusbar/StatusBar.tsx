import { useMemo } from 'react';
import { useAppStore } from '../../store';
import { formatBytes } from '../../types/memory';
import MemoryBar from './MemoryBar';

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);

  if (!tab) return null;

  const kernelName = tab.notebook.metadata.kernelspec?.display_name ?? 'No Kernel';

  // 3.4: Estimate notebook output size
  const outputStats = useMemo(() => {
    let totalBytes = 0;
    let imageCount = 0;
    let largestCell = 0;

    for (const cell of tab.notebook.cells) {
      if (!cell.outputs) continue;
      let cellBytes = 0;
      for (const output of cell.outputs) {
        const json = JSON.stringify(output);
        cellBytes += json.length;
        // Count images
        const data = output.data as Record<string, unknown> | undefined;
        if (data?.['image/png'] || data?.['image/jpeg']) imageCount++;
      }
      totalBytes += cellBytes;
      if (cellBytes > largestCell) largestCell = cellBytes;
    }

    return { totalBytes, imageCount, largestCell };
  }, [tab.notebook.cells]);

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
        <div className="status-bar-item">
          {tab.editMode ? 'Edit' : 'Command'}
        </div>
      </div>

      <div className="status-bar-right">
        {outputStats.totalBytes > 0 && (
          <div
            className="status-bar-item status-bar-outputs"
            title={`Outputs: ${formatBytes(outputStats.totalBytes)} (${outputStats.imageCount} images, largest cell: ${formatBytes(outputStats.largestCell)})`}
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
