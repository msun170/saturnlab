# Step 3: Output Memory Management - Context

## Current State

Steps 1 and 2 are complete. Saturn is a full JupyterLab Desktop clone with:
- Multi-tab notebooks, sidebar (files, kernels, TOC, variable inspector), status bar
- Full memory tooling: variable inspector with deep sizing, category breakdown, RAM indicator,
  per-cell memory delta, duplicate detection, unused variable hints, memory snapshots
- 91 frontend tests + 5 Rust tests, all passing
- Zustand store for state management, iopub routing per kernel

## What Step 3 Does

Frontend-side memory optimization. Makes Saturn feel fast with large notebooks.

## Step 3 Plan

3.1 Virtual Scrolling - react-window VariableSizeList, only visible cells in DOM
3.2 Lazy Image Decoding - IntersectionObserver, decode base64 when scrolled into view
3.3 Output Pagination - truncate >100 lines with "Show more" button
3.4 Output Memory Accounting - track total output bytes, show in inspector
3.5 Save-Without-Bloat - save without outputs, strip large outputs
3.6 Preview Mode - truncate large tables/images automatically
3.7 Frontend Output Dedup - release offscreen images, thumbnail strategy

## Key Files

- src/components/notebook/Notebook.tsx (627 lines) - main notebook, renders all cells
- src/components/notebook/CodeCell.tsx - individual code cell
- src/components/output/OutputArea.tsx - output container
- src/components/output/ImageOutput.tsx - image rendering (base64)
- src/components/output/TextOutput.tsx - text output
- src/components/output/HtmlOutput.tsx - HTML/DataFrame rendering
- src/App.css - all styles
- package.json - needs react-window for virtual scrolling

## Architecture Notes

- Currently ALL cells render in DOM (no virtualization)
- Images are always decoded (base64 -> img src)
- No output truncation
- Save always includes all outputs
- Notebook.tsx uses key={tab.id} for remount on tab switch
- Cells are CellState[] in local useState, synced to store via onNotebookChange
