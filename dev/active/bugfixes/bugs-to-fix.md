# Bugs to Fix (Next Session)

## 1. Ctrl+R should reload app but keep tabs open
- Currently reloading loses all tab state
- Need to persist tab state (filePaths, activeTabId) to localStorage or Tauri storage
- On app start, restore tabs from saved state
- Priority: medium

## 2. Tab key doesn't accept autocomplete
- Tab still moves focus outside the cell instead of accepting completion
- The `acceptCompletion` from CodeMirror is imported but not working
- The issue is likely that Tab is being captured by the browser's focus management
  before CodeMirror's keymap can handle it
- Need to use `Prec.highest` on the Tab keymap for acceptCompletion
- Or use a different approach: configure CodeMirror to handle Tab natively
- Priority: high

## 3. Collapse arrow position wrong
- Arrow needs to be where the red dot is in screenshot (top-left corner of the cell content area)
- Currently positioned with `left: calc(var(--prompt-width) + 8px)` which puts it too far right
- The arrow should be at the very start of the rendered markdown text
- Need to put it INSIDE the MarkdownCell component's rendered area, not as a sibling
- Priority: medium

## 4. Drag and drop still shows red blocking cursor
- The drag handle shows braille dots but dragging still gets blocked
- Possible causes:
  - CodeMirror editor inside the cell is intercepting drag events
  - The `onDragOver` handler on the cell-container isn't getting called
  - WebView2 on Windows may have drag-and-drop restrictions
- Try: make the cell-actions buttons (up/down arrows) more prominent as primary reorder method
- Try: use a completely separate drag overlay that doesn't conflict with CM
- Priority: low (up/down buttons work as alternative)

## 5. Ctrl+Z doesn't work in command mode
- User wants Ctrl+Z to undo text changes even when in command mode (after Esc)
- Current behavior: command mode handler skips when Ctrl is held, but the keypress
  doesn't reach CodeMirror because the cell isn't focused
- Fix: when Ctrl+Z is pressed in command mode, programmatically focus the last
  edited cell's CodeMirror editor and dispatch undo
- Priority: high

## Current State
- 96 tests passing
- 0 ESLint errors (1 warning: unused _dragIndex)
- All Steps 1-4 complete except these 5 bugs
- Last commit: 59b58ca

## Files Most Likely to Change
- src/components/notebook/CodeCell.tsx (autocomplete, Ctrl+Z)
- src/components/notebook/Notebook.tsx (drag, collapse, Ctrl+Z)
- src/App.css (collapse arrow position)
- src/App.tsx or src/hooks/ (Ctrl+R tab persistence)
