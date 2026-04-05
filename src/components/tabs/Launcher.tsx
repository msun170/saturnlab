import { useAppStore } from '../../store';
import type { KernelSpec } from '../../types/kernel';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
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
              <span className="launcher-section-icon">{'\u25A3'}</span>
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
              <span className="launcher-section-icon">{'\u2022'}</span>
              <h2 className="launcher-section-title">Other</h2>
            </div>
            <div className="launcher-card-container">
              <div
                className="launcher-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  const store = useAppStore.getState();
                  const activeTab = store.getActiveTab();
                  if (activeTab) {
                    store.updateTab(activeTab.id, {
                      fileName: 'Terminal',
                      isLauncher: false,
                      isTerminal: true,
                    });
                  }
                }}
              >
                <div className="launcher-card-icon">
                  <span className="launcher-card-other-icon" style={{ fontFamily: 'monospace', fontSize: '32px', color: 'var(--text-color)' }}>$_</span>
                </div>
                <div className="launcher-card-label">
                  <p>Terminal</p>
                </div>
              </div>
              <div
                className="launcher-card"
                role="button"
                tabIndex={0}
                onClick={async () => {
                  // Open file dialog for any text file
                  const selected = await open({
                    multiple: false,
                    filters: [
                      { name: 'Text Files', extensions: ['py', 'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'toml', 'yaml', 'yml', 'css', 'html', 'csv', 'sh', 'bat', 'cfg', 'ini', 'env', 'gitignore', 'log'] },
                      { name: 'All Files', extensions: ['*'] },
                    ],
                  });
                  if (!selected) return;
                  const path = typeof selected === 'string' ? selected : (selected as unknown as { path: string }).path;
                  if (!path) return;

                  try {
                    const content = await invoke<string>('read_text_file', { path });
                    const fileName = path.split(/[\\/]/).pop() ?? 'Untitled.txt';
                    const store = useAppStore.getState();
                    const activeTab = store.getActiveTab();
                    if (activeTab && activeTab.isLauncher) {
                      store.updateTab(activeTab.id, {
                        fileName,
                        filePath: path,
                        isLauncher: false,
                        isTextEditor: true,
                        textContent: content,
                      });
                    } else {
                      store.addTab({
                        fileName,
                        filePath: path,
                        isTextEditor: true,
                        textContent: content,
                      });
                    }
                  } catch (e) {
                    useAppStore.getState().setError(`Failed to open file: ${e}`);
                  }
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    (e.currentTarget as HTMLElement).click();
                  }
                }}
              >
                <div className="launcher-card-icon">
                  <span className="launcher-card-other-icon">{'\u2B1A'}</span>
                </div>
                <div className="launcher-card-label">
                  <p>Open Text File</p>
                </div>
              </div>
              <div
                className="launcher-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  const store = useAppStore.getState();
                  const activeTab = store.getActiveTab();
                  if (activeTab && activeTab.isLauncher) {
                    store.updateTab(activeTab.id, {
                      fileName: 'Untitled.txt',
                      isLauncher: false,
                      isTextEditor: true,
                      textContent: '',
                    });
                  } else {
                    store.addTab({
                      fileName: 'Untitled.txt',
                      isTextEditor: true,
                      textContent: '',
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    (e.currentTarget as HTMLElement).click();
                  }
                }}
              >
                <div className="launcher-card-icon">
                  <span className="launcher-card-other-icon" style={{ fontSize: '28px' }}>{'\u002B'}</span>
                </div>
                <div className="launcher-card-label">
                  <p>New Text File</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
