import { useAppStore } from '../../store';
import { confirm } from '@tauri-apps/plugin-dialog';

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);

  const doClose = (tabId: string) => {
    const tab = useAppStore.getState().tabs.find((t) => t.id === tabId);
    if (tab?.kernelId) {
      import('../../lib/ipc').then(({ stopKernel }) => stopKernel(tab.kernelId!));
    }
    useAppStore.getState().removeTab(tabId);
  };

  const handleClose = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const tab = useAppStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Use Tauri native confirm dialog (async, shows before any UI changes)
    if (tab.isDirty && !tab.isLauncher) {
      const confirmed = await confirm(
        `"${tab.fileName}" has unsaved changes. Close anyway?`,
        { title: 'Unsaved Changes', kind: 'warning' },
      );
      if (!confirmed) return;
    }

    doClose(tabId);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      handleClose(e, tabId);
    }
  };

  const handleNewTab = () => {
    useAppStore.getState().addTab({ fileName: 'Launcher', isLauncher: true });
  };

  const handleSwitchTab = (tabId: string) => {
    useAppStore.getState().setActiveTab(tabId);
  };

  return (
    <div className="saturn-tab-bar">
      <div className="saturn-tab-bar-content">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`saturn-tab ${tab.id === activeTabId ? 'saturn-tab-active' : ''} ${tab.suspensionLayer === 'layerA' || tab.suspensionLayer === 'layerC' ? 'saturn-tab-suspended' : ''}`}
            onClick={() => handleSwitchTab(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
            title={
              tab.suspensionLayer === 'layerC'
                ? `${tab.fileName} (kernel stopped)`
                : tab.suspensionLayer === 'layerA'
                ? `${tab.fileName} (suspended)`
                : tab.filePath ?? tab.fileName
            }
          >
            <span className="saturn-tab-icon">
              {tab.isLauncher ? '+' : tab.suspensionLayer === 'layerC' ? '\u23F8' : tab.suspensionLayer === 'layerA' ? '\u263E' : '\u{25A3}'}
            </span>
            <span className="saturn-tab-label">{tab.fileName}</span>
            {tab.isDirty && <span className="saturn-tab-dirty">&bull;</span>}
            <button
              className="saturn-tab-close"
              onClick={(e) => handleClose(e, tab.id)}
              title="Close"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      <button className="saturn-tab-add" onClick={handleNewTab} title="New notebook">
        +
      </button>
    </div>
  );
}
