# SaturnLab Review Checklist

## Must Verify Before Wider Release

- [ ] Frontend test suite runs cleanly outside the current sandboxed environment.
- [ ] App starts cleanly in dev and production builds on Windows.
- [ ] Tauri bundle/install flow works end-to-end on a clean machine.
- [ ] Basic smoke test passes for notebook open, edit, run, save, save-as, and close.
- [ ] Crash recovery works for both notebook tabs and text-editor tabs.

## Notebook Fidelity

- [ ] Round-trip test a corpus of real-world `.ipynb` files from different sources.
- [ ] Confirm cell metadata, notebook metadata, attachments, IDs, and outputs are preserved.
- [ ] Verify import/export behavior for Python and HTML on complex notebooks.
- [ ] Test large output notebooks and notebooks with very large tables.
- [ ] Test malformed or partially corrupted notebooks and confirm graceful failure.

## Kernel Lifecycle

- [ ] Verify start, stop, interrupt, restart, and restart-and-run-all across kernels.
- [ ] Confirm per-tab kernel ownership survives tab switching and suspension.
- [ ] Test remote-kernel flows and document unsupported features clearly in UI.
- [ ] Verify reconnect/failure states after kernel crash or server disconnect.
- [ ] Confirm terminals and kernels do not leak processes after tab/app close.

## Widgets And Rich Output

- [ ] Test common widget stacks: `ipywidgets`, `anywidget`, Plotly, Altair, Bokeh.
- [ ] Confirm iframe sandboxing does not break expected widget behavior.
- [ ] Verify widget cleanup on tab close, kernel restart, and repeated re-renders.
- [ ] Check CSP compatibility for all supported rich output paths.

## Memory Tooling

- [ ] Validate per-cell memory deltas on real workloads.
- [ ] Check variable inspector accuracy for pandas, NumPy, torch, and plain Python objects.
- [ ] Verify duplicate detection and snapshot diff results feel trustworthy.
- [ ] Confirm suspension and auto-stop policies do not surprise users.
- [ ] Add explanatory UI copy for what RSS/deltas mean and their limitations.

## Saving And File Safety

- [ ] Implement or verify atomic writes for notebooks and text files.
- [ ] Detect external file changes while a tab is open.
- [ ] Decide on backup/versioned recovery behavior for failed saves.
- [ ] Test rename/save flows for open tabs, moved files, and deleted files.
- [ ] Verify autosave timing and failure behavior under heavy editing.

## UX And UI Polish

- [ ] Check empty states, loading states, and error banners across major panels.
- [ ] Review keyboard shortcuts against actual behavior.
- [ ] Test layout on smaller laptop screens and high-DPI displays.
- [ ] Check resizing behavior for sidebar, outputs, terminal, and widgets.
- [ ] Review accessibility basics: focus visibility, keyboard navigation, readable contrast.

## Performance

- [ ] Measure startup time on a clean machine.
- [ ] Measure memory use with multiple tabs and large notebooks open.
- [ ] Check for slow renders when scrolling long notebooks.
- [ ] Test large text files and large output cells in the editor/UI.
- [ ] Profile widget-heavy notebooks and many-output notebooks.

## Packaging And Trust

- [ ] Verify installer signing/notarization strategy.
- [ ] Confirm file associations and open-with behavior for `.ipynb`.
- [ ] Review settings migration behavior between app versions.
- [ ] Add a small compatibility/support matrix in the README.
- [ ] Document local-vs-remote feature differences clearly.
