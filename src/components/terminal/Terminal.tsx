import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import 'xterm/css/xterm.css';

interface TerminalProps {
  terminalId: string;
  cwd?: string;
  showHeader?: boolean;
  onClose?: () => void;
}

export default function TerminalPanel({ terminalId, cwd, showHeader = true, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const [ready, setReady] = useState(false);

  // Phase 1: wait for container to have layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let raf: number;
    const check = () => {
      if (cancelled) return;
      const { width, height } = el.getBoundingClientRect();
      if (width > 10 && height > 10) {
        setReady(true);
      } else {
        raf = requestAnimationFrame(check);
      }
    };
    raf = requestAnimationFrame(check);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [terminalId]);

  // Phase 2: init xterm once container is laid out
  useEffect(() => {
    if (!ready) return;
    const el = containerRef.current;
    if (!el) return;

    const ptyId = `pty-${terminalId}`;
    let cleaned = false;

    const term = new XTerm({
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4' },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    try { fit.fit(); } catch { /* */ }

    const dataDisp = term.onData((data) => {
      invoke('write_terminal', { id: ptyId, data }).catch(() => {});
    });
    const binDisp = term.onBinary((data) => {
      invoke('write_terminal', { id: ptyId, data }).catch(() => {});
    });

    let unlisten: (() => void) | null = null;

    // CRITICAL: await listener registration BEFORE spawning PTY
    // so we don't miss the shell prompt
    (async () => {
      if (cleaned) return;

      // 1. Register the listener and WAIT for it to be active
      unlisten = await listen<{ id: string; data: string }>('terminal-output', (event) => {
        if (event.payload.id === ptyId) {
          term.write(event.payload.data);
        }
      });

      if (cleaned) { unlisten(); return; }

      // 2. NOW spawn the PTY (listener is guaranteed active)
      try {
        await invoke('spawn_terminal', { id: ptyId, cwd: cwd ?? null });
      } catch (e: unknown) {
        term.write(`\r\nFailed to start terminal: ${e}\r\n`);
        return;
      }

      if (cleaned) return;

      // 3. Fit and focus
      try { fit.fit(); } catch { /* */ }
      term.focus();
      const ta = el.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null;
      if (ta) ta.focus();
    })();

    const obs = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* */ }
    });
    obs.observe(el);

    return () => {
      cleaned = true;
      obs.disconnect();
      dataDisp.dispose();
      binDisp.dispose();
      if (unlisten) unlisten();
      invoke('kill_terminal', { id: ptyId }).catch(() => {});
      term.dispose();
      termRef.current = null;
      setReady(false);
    };
  }, [ready, terminalId]);

  return (
    <div className="terminal-panel">
      {showHeader && (
        <div className="terminal-header">
          <span>Terminal</span>
          {onClose && <button className="terminal-close" onClick={onClose}>&times;</button>}
        </div>
      )}
      <div
        ref={containerRef}
        className="terminal-container"
        onClick={() => {
          termRef.current?.focus();
          const ta = containerRef.current?.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null;
          if (ta) ta.focus();
        }}
      />
    </div>
  );
}
