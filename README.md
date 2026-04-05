# Saturn

**A Jupyter notebook that shows you where your RAM goes.**

Saturn is a lightweight desktop notebook app with built-in memory visibility. It runs the same `.ipynb` files and the same kernels you already use, but every cell shows its memory cost, every variable shows its footprint, and the whole thing fits in 17 MB instead of 700.

`28 MB idle` | `4s cold start` | `5 MB installer` | `17 MB on disk`

---

![Saturn memory visibility](assets/gifs/hero_memory_1.gif)

---

## Why this exists

If you've spent time with notebooks, you've run into this: the kernel crashes, and you have no idea why. You don't know which cell ate the RAM. You don't know which variables are quietly holding onto gigabytes. You don't know whether the problem is your data or your outputs.

Jupyter doesn't surface any of this. Saturn does.

Every cell shows a memory delta after it runs. The variable inspector tells you exactly how large each object is, down to the byte, with deep sizing for DataFrames, arrays, and tensors. Output accounting lets you see which cells are bloating your notebook before you save. And it all runs in a native desktop window that uses a fraction of the resources.

---

## Memory tracking

![Per-cell memory tracking](assets/gifs/per_cell_memory_tracking_3_and_4.gif)

Run a cell, and the memory delta appears immediately. Import pandas: +2 MB. Create a million-row DataFrame: +80 MB. You always know exactly what each cell costs.

The variable inspector in the sidebar sorts everything by size and supports deep introspection for pandas, numpy, and pytorch objects. If something is eating your RAM, you'll find it in seconds.

---

## Feature tour

![Feature tour](assets/gifs/features_2.gif)

Multi-tab notebooks, dark mode, integrated terminal, command palette, drag-and-drop cell reordering, collapsible headings, kernel-powered autocomplete, and more. Saturn covers the workflow you expect from a notebook app, just without the overhead.

---

## How it compares

### Size

| | Saturn | JupyterLab Desktop |
|---|--------|-------------------|
| Installer | 5 MB | 500 MB |
| On disk | 17 MB | 694 MB |

<table>
<tr>
<td><img src="assets/screenshots/saturn-installation-size.png" alt="Saturn: 16.8 MB" width="400"></td>
<td><img src="assets/screenshots/jupyter-installation-size.png" alt="JupyterLab: 694 MB" width="400"></td>
</tr>
</table>

### Startup

| | Saturn | JupyterLab Desktop |
|---|--------|-------------------|
| Cold start | ~4 seconds | ~14 seconds |

<table>
<tr>
<td>
<strong>Saturn</strong><br>
<img src="assets/gifs/saturn-startup.gif" alt="Saturn startup" width="400">
</td>
<td>
<strong>JupyterLab Desktop</strong><br>
<img src="assets/gifs/jupyter-startup.gif" alt="JupyterLab startup" width="400">
</td>
</tr>
</table>

### Memory

| | Saturn | JupyterLab Desktop |
|---|--------|-------------------|
| Idle RAM | 28 MB (everything included) | 117 MB server + 200-400 MB browser |

Saturn includes the entire application in that number: the WebView, the UI, and the Rust backend. JupyterLab's 117 MB is just the Python server; the browser tab it needs adds another few hundred megabytes on top.

### Features

| | Saturn | Jupyter |
|---|--------|---------|
| Per-cell RAM tracking | Yes | No |
| Variable memory inspector | Built-in, deep sizing | Basic, no sizes |
| Output size tracking | Yes | No |
| Save without outputs | One click | Manual |
| Stale cell indicators | Yes | No |
| Execution order warnings | Yes | No |
| Interactive widgets | Yes (anywidget) | Yes |
| AI code assistance | Built-in | Extension |

Saturn reads and writes standard `.ipynb` files and uses standard Jupyter kernels. It's not trying to replace the Jupyter ecosystem. It's a different frontend for people who want to see what's happening under the hood.

---

## Screenshots

<table>
<tr>
<td><img src="assets/screenshots/saturn-light.png" alt="Light mode" width="400"></td>
<td><img src="assets/screenshots/saturn-dark.png" alt="Dark mode" width="400"></td>
</tr>
<tr>
<td><img src="assets/screenshots/variable-inspector.png" alt="Variable inspector" width="400"></td>
<td><img src="assets/screenshots/stale-cell.png" alt="Stale cell indicators" width="400"></td>
</tr>
<tr>
<td><img src="assets/screenshots/terminal.png" alt="Terminal" width="400"></td>
<td><img src="assets/screenshots/ai-explanation.png" alt="AI explain" width="400"></td>
</tr>
</table>

---

## What's included

**Memory tools** -- per-cell RAM deltas, variable inspector with deep sizing, duplicate object detection, output size accounting, save-without-outputs workflow, memory snapshots and diff.

**Notebook features** -- multi-tab notebooks, dark mode, integrated terminal, text editor, anywidget support, stale cell indicators, execution order warnings, drag-and-drop cells, collapsible headings, search and replace, command palette, kernel-powered autocomplete and tooltips, export to .py and HTML.

**AI assistance** -- explain cell, fix error, multiple providers (OpenAI, Anthropic, Ollama for local models).

**Performance** -- 28 MB idle, 4s cold start, CSS-based virtual scrolling, lazy output loading, three-tier tab suspension (background freeze, UI unmount, kernel auto-stop).

---

## Installation

Download the latest installer from [Releases](https://github.com/YOUR_USERNAME/saturn/releases):

- **Windows**: `Saturn_0.1.0_x64-setup.exe` or `.msi`
- **macOS**: `.dmg` (Apple Silicon and Intel)
- **Linux**: `.AppImage` or `.deb`

You'll need a Jupyter kernel installed. If you have Python:

```bash
pip install ipykernel
```

### Build from source

```bash
git clone https://github.com/YOUR_USERNAME/saturn.git
cd saturn
npm install
npm run tauri dev      # development
npm run tauri build    # production
```

Requires Node.js 18+, Rust 1.70+, and [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

---

## Architecture

Saturn is built on [Tauri v2](https://v2.tauri.app/) -- a Rust backend with the OS-native WebView instead of bundling Chromium. That's why the app is 17 MB instead of 150+.

The backend handles kernel communication (pure Rust ZeroMQ, no C bindings), process memory monitoring, filesystem operations, and PTY terminal management. The frontend is React with TypeScript, CodeMirror 6, and Zustand for state. All rich output and widget code runs in sandboxed iframes with no access to the main application.

---

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can talk through the approach.

```bash
npm run tauri dev                              # dev server
npx tsc --noEmit                               # type check
npx vitest run                                 # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml # rust tests
```

---

## Roadmap

- [ ] Plugin / extension API
- [ ] Real-time collaboration

---

## License

[MIT](LICENSE)
