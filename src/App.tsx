import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { listKernelspecs, startKernel, stopKernel, executeCode } from './lib/ipc';
import type { KernelSpec, KernelOutput } from './types/kernel';
import './App.css';

interface CellOutput {
  type: string;
  content: string;
}

function App() {
  const [kernelspecs, setKernelspecs] = useState<KernelSpec[]>([]);
  const [kernelId, setKernelId] = useState<string | null>(null);
  const [kernelStatus, setKernelStatus] = useState<'disconnected' | 'starting' | 'idle' | 'busy'>('disconnected');
  const [code, setCode] = useState('print("Hello from Saturn!")');
  const [outputs, setOutputs] = useState<CellOutput[]>([]);
  const [executionCount, setExecutionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Discover kernelspecs on mount
  useEffect(() => {
    listKernelspecs()
      .then(setKernelspecs)
      .catch((e: unknown) => setError(`Failed to discover kernels: ${e}`));
  }, []);

  // Listen for kernel output events
  useEffect(() => {
    const unlisten = listen<KernelOutput>('kernel-output', (event) => {
      const { msg_type, content } = event.payload;

      switch (msg_type) {
        case 'stream': {
          const text = (content.text as string) ?? '';
          setOutputs((prev) => [...prev, { type: 'stream', content: text }]);
          break;
        }
        case 'execute_result': {
          const data = content.data as Record<string, string> | undefined;
          const text = data?.['text/plain'] ?? JSON.stringify(content);
          setOutputs((prev) => [...prev, { type: 'execute_result', content: text }]);
          break;
        }
        case 'display_data': {
          const data = content.data as Record<string, string> | undefined;
          if (data?.['image/png']) {
            setOutputs((prev) => [
              ...prev,
              { type: 'image', content: data['image/png'] },
            ]);
          } else if (data?.['text/html']) {
            setOutputs((prev) => [
              ...prev,
              { type: 'html', content: data['text/html'] },
            ]);
          } else {
            const text = data?.['text/plain'] ?? JSON.stringify(content);
            setOutputs((prev) => [...prev, { type: 'display_data', content: text }]);
          }
          break;
        }
        case 'error': {
          const traceback = (content.traceback as string[]) ?? [];
          setOutputs((prev) => [
            ...prev,
            { type: 'error', content: traceback.join('\n') },
          ]);
          break;
        }
        case 'status': {
          const state = content.execution_state as string;
          if (state === 'idle') setKernelStatus('idle');
          if (state === 'busy') setKernelStatus('busy');
          break;
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleStartKernel = useCallback(async (specName: string) => {
    setError(null);
    setKernelStatus('starting');
    try {
      const id = await startKernel(specName);
      setKernelId(id);
      setKernelStatus('idle');
    } catch (e: unknown) {
      setError(`Failed to start kernel: ${e}`);
      setKernelStatus('disconnected');
    }
  }, []);

  const handleStopKernel = useCallback(async () => {
    if (!kernelId) return;
    try {
      await stopKernel(kernelId);
      setKernelId(null);
      setKernelStatus('disconnected');
    } catch (e: unknown) {
      setError(`Failed to stop kernel: ${e}`);
    }
  }, [kernelId]);

  const handleExecute = useCallback(async () => {
    if (!kernelId || !code.trim()) return;
    setOutputs([]);
    setError(null);
    try {
      await executeCode(kernelId, code);
      setExecutionCount((c) => c + 1);
    } catch (e: unknown) {
      setError(`Execution failed: ${e}`);
    }
  }, [kernelId, code]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleExecute();
      }
    },
    [handleExecute],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Saturn</h1>
        <span className="subtitle">Lightweight Jupyter Notebook</span>
        <div className="kernel-status">
          <span className={`status-dot ${kernelStatus}`} />
          {kernelStatus}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* Kernel Selection */}
      {!kernelId && (
        <div className="kernel-picker">
          <h3>Select a Kernel</h3>
          {kernelspecs.length === 0 ? (
            <p className="muted">
              No kernels found. Make sure Jupyter/IPython is installed:{' '}
              <code>pip install ipykernel</code>
            </p>
          ) : (
            <div className="kernel-list">
              {kernelspecs.map((spec) => (
                <button
                  key={spec.name}
                  className="kernel-button"
                  onClick={() => handleStartKernel(spec.name)}
                >
                  {spec.display_name}
                  <span className="kernel-lang">{spec.language}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Code Cell */}
      {kernelId && (
        <div className="cell">
          <div className="cell-header">
            <span className="execution-count">
              [{kernelStatus === 'busy' ? '*' : executionCount || ' '}]
            </span>
            <button onClick={handleExecute} disabled={kernelStatus === 'busy'}>
              Run (Shift+Enter)
            </button>
            <button onClick={handleStopKernel} className="stop-btn">
              Stop Kernel
            </button>
          </div>
          <textarea
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={6}
            spellCheck={false}
            placeholder="Enter Python code..."
          />

          {/* Output Area */}
          {outputs.length > 0 && (
            <div className="output-area">
              {outputs.map((output, i) => {
                if (output.type === 'image') {
                  return (
                    <img
                      key={i}
                      src={`data:image/png;base64,${output.content}`}
                      alt="Output"
                      className="image-output"
                    />
                  );
                }
                if (output.type === 'html') {
                  return (
                    <div
                      key={i}
                      className="html-output"
                      dangerouslySetInnerHTML={{ __html: output.content }}
                    />
                  );
                }
                if (output.type === 'error') {
                  return (
                    <pre key={i} className="error-output">
                      {output.content}
                    </pre>
                  );
                }
                return (
                  <pre key={i} className="text-output">
                    {output.content}
                  </pre>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
