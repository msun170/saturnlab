# Step 4: Productivity Features - Context

## Completed
- 4.1 Multi-tab (done in 1.8)
- 4.2 File browser sidebar (done in 1.10)
- 4.6 Table of contents (done in 1.10)
- 4.8 Auto-save (30s interval for dirty tabs with file paths)
- 4.10 Command palette (Ctrl+Shift+P, 22 commands, fuzzy search)
- 4.11 Multi-kernel (inherent in multi-tab architecture)
- 4.12 Smart kernel discovery (done in 1.0, uses jupyter_core.paths)
- 4.13 Idle kernel auto-shutdown (done in 2.0c, disabled by default)

## Also Done (TODOs)
- Confirm before closing unsaved tab (window.confirm dialog)
- Running cells marks tab as dirty
- Run All Above / Run All Below (Cell menu + NotebookHandle)

## Remaining
- 4.3 Search and replace within notebook
- 4.4 Kernel-powered autocomplete (complete_request on shell channel)
- 4.5 Tooltip/inspect on Shift+Tab (inspect_request on shell channel)
- 4.7 Collapsible headings
- 4.9 Drag-and-drop cell reordering

## Notes for 4.4 Autocomplete
- Jupyter protocol: send complete_request on shell, receive complete_reply
- Need to integrate with CodeMirror 6 autocompletion API
- CodeMirror provides `autocompletion()` extension with `completionSource`
- The source would send complete_request and wait for reply
- Challenge: async completion with ZMQ round-trip latency

## Notes for 4.5 Tooltip
- Jupyter protocol: send inspect_request on shell, receive inspect_reply
- Triggered by Shift+Tab in edit mode
- Shows function signature and docstring
- Need to display as a tooltip/popup near cursor in CodeMirror

## Current Stats
- 96 frontend tests, all passing
- 0 ESLint errors, 0 clippy warnings
- ~3,600 lines TS source, ~1,000 lines tests, ~1,400 lines Rust
