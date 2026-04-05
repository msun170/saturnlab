import { useEffect, useRef, useReducer, useCallback } from 'react';
import { getModel, subscribe } from '../../lib/widgetManager';

interface WidgetOutputProps {
  modelId: string;
}

/**
 * Renders an anywidget inside a sandboxed iframe.
 *
 * The ESM code runs in the iframe (sandbox="allow-scripts") with NO access
 * to the parent window, Tauri IPC, or the filesystem. State sync happens
 * via postMessage between the iframe and the main window.
 *
 * Protocol:
 *   iframe -> parent: { type: "widget-get", key }           -> parent responds with { type: "widget-value", key, value }
 *   iframe -> parent: { type: "widget-set", key, value }    -> parent sets on model
 *   iframe -> parent: { type: "widget-save" }               -> parent calls model.save_changes()
 *   iframe -> parent: { type: "widget-send", content }      -> parent calls model.send(content)
 *   iframe -> parent: { type: "widget-on", event }          -> parent subscribes, forwards changes
 *   parent -> iframe: { type: "widget-event", event, key, value } -> fires registered listeners
 *   parent -> iframe: { type: "widget-init", state }        -> initial state snapshot
 */
export default function WidgetOutput({ modelId }: WidgetOutputProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Retry if model not ready
  const model = getModel(modelId);
  useEffect(() => {
    if (!model) {
      const timer = setTimeout(() => forceUpdate(), 100);
      return () => clearTimeout(timer);
    }
  }, [model]);

  useEffect(() => {
    return subscribe(modelId, forceUpdate);
  }, [modelId]);

  // Track listeners registered via widget-on so we can clean up on unmount
  const listenersRef = useRef<{ event: string; cb: () => void }[]>([]);

  // Handle postMessage from iframe
  const handleMessage = useCallback((event: MessageEvent) => {
    if (!model) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;

    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'widget-get':
        iframe.contentWindow.postMessage({
          type: 'widget-value',
          key: msg.key,
          value: model.get(msg.key),
        }, '*');
        break;
      case 'widget-set':
        model.set(msg.key, msg.value);
        break;
      case 'widget-save':
        model.save_changes();
        break;
      case 'widget-send':
        model.send(msg.content);
        break;
      case 'widget-on': {
        const cb = () => {
          iframe.contentWindow?.postMessage({
            type: 'widget-event',
            event: msg.event,
            key: msg.event.startsWith('change:') ? msg.event.slice(7) : undefined,
            value: msg.event.startsWith('change:') ? model.get(msg.event.slice(7)) : undefined,
          }, '*');
        };
        model.on(msg.event, cb);
        listenersRef.current.push({ event: msg.event, cb });
        break;
      }
    }
  }, [model]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      // Unsubscribe all widget-on listeners from the model
      if (model) {
        for (const { event, cb } of listenersRef.current) {
          model.off(event, cb);
        }
      }
      listenersRef.current = [];
    };
  }, [handleMessage]);

  if (!model) {
    return <div className="widget-output widget-not-found">Widget not found</div>;
  }

  const esm = model.get('_esm') as string | undefined;
  const css = model.get('_css') as string | undefined;
  if (!esm) {
    return <div className="widget-output">Widget has no ESM</div>;
  }

  // Build the initial state snapshot (exclude internal fields)
  const stateSnapshot: Record<string, unknown> = {};
  const fullState = model as unknown as { state: Record<string, unknown> };
  if (fullState.state) {
    for (const [k, v] of Object.entries(fullState.state)) {
      if (!k.startsWith('_')) stateSnapshot[k] = v;
    }
  }

  // Build iframe srcDoc with the ESM code and a postMessage-based model proxy
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bg = isDark ? '#1e1e1e' : '#fff';
  const color = isDark ? '#d4d4d4' : '#333';

  const cssBlock = css && !css.startsWith('http')
    ? `<style>${css}</style>`
    : css ? `<link rel="stylesheet" href="${css}">` : '';

  const srcDoc = `<!DOCTYPE html>
<html><head>
<style>body{margin:0;padding:8px;font-family:sans-serif;background:${bg};color:${color}}</style>
${cssBlock}
</head><body>
<div id="widget-root"></div>
<script type="module">
// State cache + listener registry
const _state = ${JSON.stringify(stateSnapshot)};
const _listeners = {};

// Model proxy (communicates with parent via postMessage)
const model = {
  get(key) { return _state[key]; },
  set(key, value) {
    _state[key] = value;
    parent.postMessage({ type: 'widget-set', key, value }, '*');
    // Fire local listeners immediately
    const cbs = _listeners['change:' + key];
    if (cbs) cbs.forEach(cb => { try { cb(); } catch(e) { console.error(e); } });
    const allCbs = _listeners['change'];
    if (allCbs) allCbs.forEach(cb => { try { cb(); } catch(e) { console.error(e); } });
  },
  save_changes() { parent.postMessage({ type: 'widget-save' }, '*'); },
  send(content) { parent.postMessage({ type: 'widget-send', content }, '*'); },
  on(event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
    // Tell parent to forward this event
    parent.postMessage({ type: 'widget-on', event }, '*');
  },
  off(event, cb) {
    if (!cb) { delete _listeners[event]; return; }
    const arr = _listeners[event];
    if (arr) _listeners[event] = arr.filter(f => f !== cb);
  }
};

// Listen for events from parent (state changes from kernel)
window.addEventListener('message', (e) => {
  if (e.data?.type === 'widget-event') {
    const ev = e.data.event;
    if (e.data.key !== undefined) _state[e.data.key] = e.data.value;
    const cbs = _listeners[ev];
    if (cbs) cbs.forEach(cb => { try { cb(); } catch(err) { console.error(err); } });
  }
});

// Load ESM and call render
const esmCode = ${JSON.stringify(esm)};
let mod;
if (esmCode.startsWith('http://') || esmCode.startsWith('https://')) {
  mod = await import(esmCode);
} else {
  const blob = new Blob([esmCode], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  mod = await import(url);
  URL.revokeObjectURL(url);
}

const renderFn = mod.render || mod.default;
if (typeof renderFn === 'function') {
  const el = document.getElementById('widget-root');
  renderFn({ model, el });
}
<\/script>
</body></html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="widget-output-iframe"
      style={{ width: '100%', border: 'none', minHeight: 48 }}
      onLoad={(e) => {
        const iframe = e.target as HTMLIFrameElement;
        // Auto-resize to content
        const resize = () => {
          try {
            const h = iframe.contentDocument?.body?.scrollHeight;
            if (h) iframe.style.height = `${Math.min(h + 16, 800)}px`;
          } catch { /* cross-origin */ }
        };
        resize();
        // Retry resize after ESM renders (async)
        setTimeout(resize, 500);
        setTimeout(resize, 1500);
      }}
    />
  );
}
