# Step 5 Remaining - Context

## Completed
- 5.1 Plotly (via CDN iframe)
- 5.2 Bokeh (partial, standalone mode only)
- 5.3 Altair/Vega (via CDN iframe)
- 5.4 iframe sandboxing (white background, scripts in sandbox)
- 5.5 Integrated terminal (xterm.js + portable-pty, View > Toggle Terminal)
- 5.6 Export to .py and HTML
- 5.7 Settings UI (persistent TOML, all values live-wired)

## Remaining
- 5.8 Cross-platform packaging + auto-update
  - Tauri v2 has built-in bundler: `npm run tauri build`
  - Creates .msi (Windows), .dmg (macOS), .AppImage (Linux)
  - Auto-update via Tauri's updater plugin
  - Need to configure signing keys, update URL, app icons

- 5.9 Performance benchmarks vs Jupyter
  - Measure: startup time, base RAM, notebook load time, output rendering
  - Compare: Saturn vs `jupyter notebook` in Chrome vs JupyterLab Desktop (archived)
  - Document in README or benchmark page

- Dark theme toggle
  - Settings UI has a `theme` field (light/dark) already
  - Need dark CSS variables for all colors
  - Toggle via settings panel
  - Apply via CSS class on root element

## Current Stats
- 96 tests passing
- ~4,200 lines TS source, ~1,000 lines tests, ~1,700 lines Rust
