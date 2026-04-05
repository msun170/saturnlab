/**
 * Widget Manager for anywidget support.
 *
 * Handles the Jupyter comm protocol (comm_open, comm_msg, comm_close)
 * and provides the model proxy that ESM widget code interacts with.
 *
 * Architecture:
 *   - Singleton module (not a React component)
 *   - widgetRegistry: Map<commId, WidgetModel>
 *   - subscribers: Map<commId, Set<() => void>> for React re-renders
 */

import { sendCommMsg } from './ipc';

// ─── Types ──────────────────────────────────────────────────────────

type ListenerFn = (...args: unknown[]) => void;

// ─── Registry (on window to survive Vite HMR reloads) ───────────────

interface WidgetGlobals {
  __saturnWidgets: Map<string, WidgetModel>;
  __saturnWidgetSubs: Map<string, Set<() => void>>;
}

const g = window as unknown as WidgetGlobals;
if (!g.__saturnWidgets) g.__saturnWidgets = new Map();
if (!g.__saturnWidgetSubs) g.__saturnWidgetSubs = new Map();

const widgetRegistry = g.__saturnWidgets;
const subscribers = g.__saturnWidgetSubs;

function notifySubscribers(commId: string) {
  const subs = subscribers.get(commId);
  if (subs) {
    for (const cb of subs) cb();
  }
}

// ─── WidgetModel ────────────────────────────────────────────────────

export class WidgetModel {
  readonly commId: string;
  readonly kernelId: string;
  private state: Record<string, unknown>;
  private listeners = new Map<string, Set<ListenerFn>>();
  private changed = new Set<string>();

  constructor(commId: string, kernelId: string, initialState: Record<string, unknown>) {
    this.commId = commId;
    this.kernelId = kernelId;
    this.state = { ...initialState };
  }

  /** Read a synced trait. */
  get(key: string): unknown {
    return this.state[key];
  }

  /** Set a trait locally (frontend-originated). Fires change events. */
  set(key: string, value: unknown): void {
    this.state[key] = value;
    this.changed.add(key);
    this.emit('change');
    this.emit(`change:${key}`);
    notifySubscribers(this.commId);
  }

  /** Send changed traits to the kernel via comm_msg. */
  save_changes(): void {
    if (this.changed.size === 0) return;
    const changedState: Record<string, unknown> = {};
    for (const key of this.changed) {
      changedState[key] = this.state[key];
    }
    this.changed.clear();
    sendCommMsg(this.kernelId, this.commId, {
      method: 'update',
      state: changedState,
    }).catch((e) => console.error('[widget] save_changes failed:', e));
  }

  /** Send a custom message to the kernel. */
  send(content: Record<string, unknown>): void {
    sendCommMsg(this.kernelId, this.commId, {
      method: 'custom',
      content,
    }).catch((e) => console.error('[widget] send failed:', e));
  }

  /** Register an event listener. Events: "change", "change:key", "msg:custom" */
  on(event: string, cb: ListenerFn): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  /** Remove an event listener. */
  off(event: string, cb?: ListenerFn): void {
    if (!cb) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(cb);
    }
  }

  /** Fire an event. */
  private emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        try { cb(...args); } catch (e) { console.error('[widget] listener error:', e); }
      }
    }
  }

  /**
   * Update state from kernel (iopub comm_msg with method "update").
   * Fires change events but does NOT add to changed set (no echo back).
   */
  updateFromKernel(newState: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(newState)) {
      this.state[key] = value;
      this.emit(`change:${key}`);
    }
    this.emit('change');
    notifySubscribers(this.commId);
  }

  /** Dispatch a custom message from kernel. */
  dispatchCustom(content: Record<string, unknown>): void {
    this.emit('msg:custom', content);
  }

  /**
   * Return the public API object that ESM render() receives.
   * This is the "model" parameter in `render({ model, el })`.
   */
  proxy(): {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    save_changes: () => void;
    send: (content: Record<string, unknown>) => void;
    on: (event: string, cb: ListenerFn) => void;
    off: (event: string, cb?: ListenerFn) => void;
  } {
    return {
      get: (key: string) => this.get(key),
      set: (key: string, value: unknown) => this.set(key, value),
      save_changes: () => this.save_changes(),
      send: (content: Record<string, unknown>) => this.send(content),
      on: (event: string, cb: ListenerFn) => this.on(event, cb),
      off: (event: string, cb?: ListenerFn) => this.off(event, cb),
    };
  }
}

// ─── Comm Handlers (called from Notebook.tsx iopub listener) ────────

export function handleCommOpen(kernelId: string, content: Record<string, unknown>): void {
  const commId = content.comm_id as string | undefined;
  const targetName = content.target_name as string | undefined;

  if (!commId) return;

  // Accept any jupyter.widget target (v7: "jupyter.widget", v8: "jupyter.widget.comm")
  if (targetName && !targetName.startsWith('jupyter.widget')) return;

  const data = content.data as Record<string, unknown> | undefined;
  const state = (data?.state as Record<string, unknown>) ?? {};

  const model = new WidgetModel(commId, kernelId, state);
  widgetRegistry.set(commId, model);
}

export function handleCommMsg(content: Record<string, unknown>): void {
  const commId = content.comm_id as string | undefined;
  if (!commId) return;

  const model = widgetRegistry.get(commId);
  if (!model) return;

  const data = content.data as Record<string, unknown> | undefined;
  if (!data) return;

  const method = data.method as string | undefined;

  if (method === 'update') {
    const state = data.state as Record<string, unknown> | undefined;
    if (state) {
      model.updateFromKernel(state);
    }
  } else if (method === 'custom') {
    const customContent = data.content as Record<string, unknown> | undefined;
    if (customContent) {
      model.dispatchCustom(customContent);
    }
  }
}

export function handleCommClose(content: Record<string, unknown>): void {
  const commId = content.comm_id as string | undefined;
  if (!commId) return;

  widgetRegistry.delete(commId);
  notifySubscribers(commId);
  subscribers.delete(commId);
}

// ─── React Integration ─────────────────────────────────────────────

export function getModel(commId: string): WidgetModel | undefined {
  return widgetRegistry.get(commId);
}

/** Subscribe to state changes for a widget. Returns unsubscribe function. */
export function subscribe(commId: string, callback: () => void): () => void {
  let set = subscribers.get(commId);
  if (!set) {
    set = new Set();
    subscribers.set(commId, set);
  }
  set.add(callback);
  return () => {
    set!.delete(callback);
    if (set!.size === 0) subscribers.delete(commId);
  };
}

/** Clean up all widgets for a kernel (called when kernel stops). */
export function destroyKernelWidgets(kernelId: string): void {
  for (const [commId, model] of widgetRegistry) {
    if (model.kernelId === kernelId) {
      widgetRegistry.delete(commId);
      notifySubscribers(commId);
      subscribers.delete(commId);
    }
  }
}

// ESM loading and CSS injection now happen inside the sandboxed iframe
// (see WidgetOutput.tsx). No code executes in the main window context.
