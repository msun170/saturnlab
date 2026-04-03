import { useAppStore } from '../../store';
import type { KernelSpec } from '../../types/kernel';
import PythonIcon from '../icons/PythonIcon';

export default function Launcher() {
  const kernelspecs = useAppStore((s) => s.kernelspecs);

  const handleNewNotebook = (spec: KernelSpec) => {
    const store = useAppStore.getState();
    // Find the launcher tab and replace it with a new notebook
    const activeTab = store.getActiveTab();
    if (activeTab) {
      store.updateTab(activeTab.id, {
        fileName: 'Untitled.ipynb',
        isLauncher: false,
        notebook: {
          nbformat: 4,
          nbformat_minor: 5,
          metadata: {
            kernelspec: {
              name: spec.name,
              display_name: spec.display_name,
              language: spec.language,
            },
          },
          cells: [
            {
              cell_type: 'code',
              source: '',
              metadata: {},
              outputs: [],
              execution_count: null,
            },
          ],
        },
      });

      // Auto-start the kernel
      import('../../lib/ipc').then(({ startKernel }) => {
        startKernel(spec.name).then((kernelId) => {
          store.updateTab(activeTab.id, { kernelId, kernelStatus: 'idle' });
        });
      });
    }
  };

  return (
    <div className="launcher">
      <div className="launcher-body">
        <div className="launcher-content">
          {/* Notebook section */}
          <div className="launcher-section">
            <div className="launcher-section-header">
              <span className="launcher-section-icon">&#128211;</span>
              <h2 className="launcher-section-title">Notebook</h2>
            </div>
            <div className="launcher-card-container">
              {kernelspecs.length > 0 ? (
                kernelspecs.map((spec) => (
                  <div
                    key={spec.name}
                    className="launcher-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNewNotebook(spec)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleNewNotebook(spec);
                    }}
                  >
                    <div className="launcher-card-icon">
                      {spec.language === 'python' ? (
                        <PythonIcon size={48} />
                      ) : (
                        <span className="launcher-card-kernel-icon">{spec.display_name.charAt(0)}</span>
                      )}
                    </div>
                    <div className="launcher-card-label">
                      <p>{spec.display_name}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="launcher-no-kernels">
                  No kernels found. Install ipykernel: <code>pip install ipykernel</code>
                </div>
              )}
            </div>
          </div>

          {/* Other section */}
          <div className="launcher-section">
            <div className="launcher-section-header">
              <span className="launcher-section-icon">&#128196;</span>
              <h2 className="launcher-section-title">Other</h2>
            </div>
            <div className="launcher-card-container">
              <div
                className="launcher-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  // TODO: Text Editor not yet implemented (Step 5.5)
                }}
              >
                <div className="launcher-card-icon">
                  <span className="launcher-card-other-icon">&#128462;</span>
                </div>
                <div className="launcher-card-label">
                  <p>Text Editor</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
