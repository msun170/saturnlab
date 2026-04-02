---
name: saturn-tauri-rust-guidelines
description: Development guidelines for Saturn notebook app. Tauri v2 + Rust + React 18 + TypeScript + CodeMirror 6 + ZeroMQ + Vite. Use when creating components, cells, output renderers, kernel management, memory tooling, Tauri IPC commands, or working with any Saturn code.
---

> **Tool directives:** Read and follow `~/.claude/skills/_shared/tool-usage.md` — use the built-in Grep tool (not bash grep), LSP for symbol comprehension, and Glob for file search.

# Saturn Development Guidelines

## Purpose

Establish consistency and best practices across Saturn (`C:\Users\nuswe\Saturn\`). A lightweight Jupyter notebook desktop app built on Tauri v2 (Rust backend) + React 18 (TypeScript frontend) + CodeMirror 6 + ZeroMQ for kernel communication.

## When to Use This Skill

- Creating or modifying React components (cells, outputs, panels, toolbars)
- Working with Rust backend modules (kernel, ZMQ, memory, filesystem)
- Implementing Tauri IPC commands
- Handling .ipynb format read/write
- Building output renderers (text, HTML, images, Plotly, Bokeh, Altair)
- Implementing memory tooling (variable inspector, RAM monitoring)
- Kernel lifecycle management (start, stop, restart, interrupt, discovery)
- CodeMirror 6 editor configuration and extensions

---

## Quick Start

### New Component Checklist

- [ ] TypeScript strict mode, no `any`, explicit prop interfaces
- [ ] All Tauri IPC calls go through `src/lib/ipc.ts` — never call `invoke()` directly in components
- [ ] Outputs render lazily — off-screen outputs are placeholders
- [ ] Large/rich HTML outputs go in sandboxed `<iframe>`
- [ ] Memory-conscious: don't hold decoded images or large strings in React state unnecessarily

### New Rust Command Checklist

- [ ] Define handler in `src-tauri/src/commands.rs`
- [ ] Delegate business logic to the appropriate module (kernel/, notebook/, etc.)
- [ ] Use `thiserror` for typed errors, return `Result<T, String>` to frontend
- [ ] Register command in `tauri::Builder::default().invoke_handler()`
- [ ] Add corresponding TypeScript wrapper in `src/lib/ipc.ts`

---

## Architecture

### Tauri IPC Pattern

All frontend-backend communication uses Tauri's `invoke` system:

**Rust side** (`commands.rs`):
```rust
#[tauri::command]
async fn execute_cell(kernel_id: String, code: String) -> Result<String, String> {
    let kernel = kernel::manager::get(&kernel_id).map_err(|e| e.to_string())?;
    kernel.execute(&code).await.map_err(|e| e.to_string())
}
```

**TypeScript side** (`lib/ipc.ts`):
```typescript
import { invoke } from '@tauri-apps/api/core';

export async function executeCell(kernelId: string, code: string): Promise<string> {
  return invoke<string>('execute_cell', { kernelId, code });
}
```

**Component side**: Use hooks that wrap IPC calls:
```typescript
const { execute, isRunning } = useKernel(kernelId);
```

### Kernel Communication (ZeroMQ)

The Jupyter Wire Protocol uses 5 ZMQ channels per kernel. All messages follow this format:

```json
{
  "header": { "msg_id": "uuid", "msg_type": "execute_request", "session": "uuid" },
  "parent_header": {},
  "content": { "code": "print('hello')", "silent": false },
  "metadata": {}
}
```

Key message types:
- `execute_request` / `execute_reply` — run code (shell channel)
- `stream` — stdout/stderr output (iopub)
- `display_data` — rich output like images, HTML (iopub)
- `error` — traceback (iopub)
- `status` — kernel busy/idle (iopub)
- `complete_request` / `complete_reply` — autocomplete (shell)
- `inspect_request` / `inspect_reply` — tooltip/docs (shell)
- `comm_open` / `comm_msg` — widget communication (iopub, for anywidget in Phase 2)

For full protocol details, see `resources/zmq-kernel-protocol.md`.

### .ipynb Format (nbformat v4)

Notebooks are JSON files. Key TypeScript types:
```typescript
interface Notebook {
  nbformat: 4;
  nbformat_minor: number;
  metadata: { kernelspec: KernelSpec; language_info?: LanguageInfo };
  cells: Cell[];
}

interface Cell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: Output[];
  execution_count?: number | null;
}

interface Output {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  data?: Record<string, string>;   // MIME bundle
  text?: string | string[];        // For stream outputs
}
```

### Memory Tooling

Variable inspection works by sending introspection code to the kernel:

```python
# Sent via execute_request on a hidden execution (silent=true)
import sys, json
_saturn_vars = {}
for _name, _obj in list(globals().items()):
    if not _name.startswith('_'):
        _saturn_vars[_name] = {
            'type': type(_obj).__name__,
            'size': sys.getsizeof(_obj),
        }
print(json.dumps(_saturn_vars))
```

OS-level kernel process memory comes from the `sysinfo` Rust crate, tracking the kernel's PID.

For full memory tooling patterns, see `resources/memory-tooling-patterns.md`.

### Output Rendering Priority

MIME bundles contain multiple representations. Render in this priority order:
1. `application/vnd.plotly.v1+json` — PlotlyOutput (if plotly.js loaded)
2. `application/vnd.vegalite.v5+json` — VegaOutput (if vega-embed loaded)
3. `text/html` — HtmlOutput (or sandboxed iframe if contains `<script>`)
4. `image/svg+xml` — inline SVG
5. `image/png` — base64 `<img>` (lazy decoded)
6. `text/latex` — KaTeX render
7. `text/plain` — TextOutput (fallback, always present)

For full rendering patterns, see `resources/output-rendering-patterns.md`.

### Virtual Scrolling

The notebook uses `react-window` (VariableSizeList) to only render visible cells:
- Each cell measures its own height after render
- Off-screen cells are unmounted — their outputs are NOT in the DOM
- Scroll position is preserved across re-renders
- This is critical for notebooks with 100+ cells or heavy plot outputs

---

## Patterns to Follow

- **Hooks for state, components for UI** — business logic in `hooks/`, rendering in `components/`
- **One Tauri command per user action** — don't batch multiple operations into one command
- **Outputs are immutable** — once received from the kernel, output data is never mutated
- **Kernel messages are events** — use Tauri's event system (`emit`/`listen`) for iopub messages, not request-response
- **CSS from JupyterLab** — adapt JupyterLab's BSD-licensed CSS, don't reinvent cell styling

## Patterns to Avoid

- **No `any` in TypeScript** — use `unknown` + type guards, or specific types from `src/types/`
- **No direct `invoke()` in components** — always go through `src/lib/ipc.ts`
- **No full DOM rendering** — never render all cells; always use virtual scrolling
- **No ipywidgets** — only anywidget (Phase 2), skip the comm complexity of full ipywidgets
- **No Python server** — the Rust backend replaces jupyter_server entirely
- **No libzmq C bindings** — use pure Rust `zeromq` crate only
