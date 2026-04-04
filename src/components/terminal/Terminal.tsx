import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import 'xterm/css/xterm.css';

interface TerminalPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function TerminalPanel({ visible, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [termId] = useState(() => `term-${Date.now()}`);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!visible || !containerRef.current || started) return;

    const term = new XTerm({
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Spawn PTY on Rust side
    invoke('spawn_terminal', { id: termId }).then(() => {
      setStarted(true);
    }).catch((e: unknown) => {
      term.write(`\r\nFailed to start terminal: ${e}\r\n`);
    });

    // Send user input to Rust PTY
    term.onData((data) => {
      invoke('write_terminal', { id: termId, data }).catch(() => {});
    });

    // Listen for PTY output from Rust
    const unlisten = listen<{ id: string; data: string }>('terminal-output', (event) => {
      if (event.payload.id === termId) {
        term.write(event.payload.data);
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unlisten.then((fn) => fn());
      resizeObserver.disconnect();
      invoke('kill_terminal', { id: termId }).catch(() => {});
      term.dispose();
    };
  }, [visible, started, termId]);

  if (!visible) return null;

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>Terminal</span>
        <button className="terminal-close" onClick={onClose}>x</button>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}
