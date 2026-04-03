import { useAppStore } from '../../store';
import MemoryBar from './MemoryBar';

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);

  if (!tab) return null;

  const kernelName = tab.notebook.metadata.kernelspec?.display_name ?? 'No Kernel';

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
