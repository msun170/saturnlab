# Saturn — Claude Guidelines

**What it is:** Lightweight Jupyter notebook desktop app — Tauri v2 + Rust backend + React/TypeScript frontend
**Stack:** Tauri v2 + Rust + React 18 + TypeScript + CodeMirror 6 + ZeroMQ + Vite
**Key differentiator:** 15MB app, 40MB RAM — replaces Jupyter's browser + Python server (500MB+)

---

## Quick Commands

```bash
npm run tauri dev               # Start Tauri dev (frontend + backend hot reload)
npm run dev                     # Frontend only (Vite dev server)
npm run build                   # Production frontend build
npm run tauri build             # Full production build (creates installer)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
npx tsc --noEmit                # TypeScript type check
```

---

## Project Structure

```
Saturn/
  src-tauri/                    # Rust backend (Tauri v2)
    src/
      kernel/                   # ZMQ kernel management (manager, zmq_client, discovery)
      notebook/                 # .ipynb read/write (serde JSON)
      memory/                   # Process memory monitoring (sysinfo)
      filesystem/               # File watching + directory listing
      terminal/                 # PTY management
      session/                  # SQLite state persistence
      settings/                 # User preferences (TOML)
      commands.rs               # All Tauri IPC command handlers
  src/                          # Frontend (React + TypeScript)
    components/
      notebook/                 # Notebook, Cell, CodeCell, MarkdownCell
      output/                   # OutputArea, TextOutput, ImageOutput, etc.
      memory/                   # VariableInspector, MemoryBar, MemoryWarning
      sidebar/                  # FileExplorer, TableOfContents, SearchPanel
      toolbar/                  # MainToolbar, KernelStatus, CommandPalette
      terminal/                 # xterm.js wrapper
      settings/                 # Preferences panel
    hooks/                      # useKernel, useNotebook, useMemory, useSettings
    lib/                        # ipc.ts, keybindings.ts, mime.ts
    types/                      # notebook.ts, kernel.ts, memory.ts
    themes/                     # light.css, dark.css (adapted from JupyterLab)
```

---

## Key Architecture Rules

- **Memory tooling is priority #1** — variable inspector, RAM indicators, and virtual scrolling are core features, not nice-to-haves
- **Kernel protocol**: All kernel communication goes through ZeroMQ (5 channels: shell, iopub, stdin, control, heartbeat). Kernels are NEVER modified.
- **No ipywidgets** — anywidget only (Phase 2). Simpler comm protocol, ES module loading.
- **Virtual scrolling always on** — never render all cells in DOM. Use react-window.
- **Output isolation** — rich HTML outputs (Plotly, Bokeh) render in sandboxed iframes
- **Copy from JupyterLab** (BSD-3-Clause): output renderer logic, CSS themes, CodeMirror config, keybindings

---

## Rust Guidelines

- Use `tokio` async runtime for all I/O
- Pure Rust `zeromq` crate — no C bindings (libzmq)
- All Tauri commands in `commands.rs`, delegate to module functions
- `serde` for all serialization — .ipynb is JSON, kernel messages are JSON
- `sysinfo` crate for process memory monitoring
- Error handling: `thiserror` for library errors, `anyhow` in commands

---

## TypeScript Guidelines

- No `any` — use `unknown` and type guards
- All Tauri IPC calls wrapped in `src/lib/ipc.ts`
- Notebook types mirror nbformat v4 spec in `src/types/notebook.ts`
- Kernel message types in `src/types/kernel.ts`
- CodeMirror extensions configured per-cell, not globally

---

## Skill

Load `saturn-tauri-rust-guidelines` skill for Tauri IPC patterns, Rust backend patterns, ZMQ kernel protocol, memory tooling implementation, and output rendering. Activates automatically for Saturn work.

---

## Dev Docs

Large tasks: `dev/active/[task-name]/` — see global CLAUDE.md for workflow.
