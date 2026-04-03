# Step 2.0/2.0b/2.0c: Memory Layers - Context

## Current State

Steps 1, 2, and 3 are complete. Saturn has:
- Full JupyterLab Desktop layout with multi-tab, sidebar, status bar, launcher
- Memory tooling: variable inspector, category breakdown, RAM indicator, per-cell delta,
  duplicate detection, unused hints, snapshots, output click-to-navigate
- Output memory: lazy images, pagination, table truncation, save without outputs, memoization
- 91 frontend tests + 5 Rust tests

## What Memory Layers Do

Three escalating levels of suspension for inactive tabs:

**Layer B (30s inactive):** Pause background work
- Buffer iopub messages instead of processing into UI
- Pause variable inspector auto-refresh
- Reduce RAM polling frequency
- Invisible to user, instant resume

**Layer A (5min inactive):** Unmount notebook DOM
- Unmount CodeMirror, images, iframes from DOM
- Keep notebook model + outputs as raw JSON in Zustand store
- Dimmed tab + moon icon
- Resume: remount view, restore scroll, lazy load

**Layer C (30-60min, configurable):** Stop kernel
- Stop the kernel process to free real RAM
- Preserve all notebook contents and outputs
- Dimmed tab + pause icon
- Resume: banner "Kernel stopped to save memory", restart button

## Key Files to Modify

- src/hooks/useSuspension.ts (NEW) - timer manager
- src/components/tabs/TabContent.tsx (NEW) - conditional Notebook/placeholder
- src/components/tabs/SuspendedPlaceholder.tsx (NEW) - minimal placeholder
- src/components/tabs/TabBar.tsx - dimmed icons for suspended tabs
- src/components/notebook/Notebook.tsx - iopub buffering, scroll save/restore
- src/store/tabStore.ts - already has suspensionLayer field
- src/App.tsx - render TabContent instead of Notebook directly

## Store State (already exists)

TabState.suspensionLayer: 'active' | 'layerB' | 'layerA' | 'layerC'
TabState.lastActiveAt: number (timestamp)
TabState.scrollPosition: number

## Architecture

- useSuspension hook subscribes to store changes outside React
- On tab deactivation: start timers for Layer B (30s) and Layer A (5min)
- On tab activation: clear timers, set to 'active', flush iopub buffer
- Layer C is configurable via settings (needs settings UI)
