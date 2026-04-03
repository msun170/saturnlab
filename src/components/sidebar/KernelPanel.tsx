import { useAppStore } from '../../store';

export default function KernelPanel() {
  const tabs = useAppStore((s) => s.tabs);

  const tabsWithKernels = tabs.filter((t) => t.kernelId);

  const handleInterrupt = (kernelId: string) => {
    import('../../lib/ipc').then(({ interruptKernel }) => interruptKernel(kernelId));
  };

  const handleStop = (tabId: string, kernelId: string) => {
    import('../../lib/ipc').then(({ stopKernel }) => {
      stopKernel(kernelId);
      useAppStore.getState().updateTab(tabId, { kernelId: null, kernelStatus: 'disconnected' });
    });
  };

  return (
    <div className="kernel-panel">
      <div className="kernel-panel-header">Running Kernels</div>
      {tabsWithKernels.length === 0 ? (
        <div className="kernel-panel-empty">No active kernels</div>
      ) : (
        <div className="kernel-panel-list">
          {tabsWithKernels.map((tab) => (
            <div key={tab.id} className="kernel-panel-item">
              <div className="kernel-panel-item-info">
                <span className={`kernel-panel-dot ${tab.kernelStatus}`} />
                <span className="kernel-panel-name">{tab.fileName}</span>
                <span className="kernel-panel-status">{tab.kernelStatus}</span>
              </div>
              <div className="kernel-panel-actions">
                <button
                  onClick={() => handleInterrupt(tab.kernelId!)}
                  title="Interrupt"
                  disabled={tab.kernelStatus !== 'busy'}
                >
                  Interrupt
                </button>
                <button
                  onClick={() => handleStop(tab.id, tab.kernelId!)}
                  title="Shut Down"
                >
                  Shut Down
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
