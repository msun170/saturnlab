# Recording Comparison GIFs and Screenshots

Tools: [ScreenToGif](https://www.screentogif.com/) (Windows) or [Kap](https://getkap.co/) (Mac)

Settings: 15 fps, 800px wide, optimize file size

## GIF 1: Hero Memory Reveal (8-12s)

The most important GIF. Shows the core value of Saturn.

1. Open Saturn with `demo_memory.ipynb` already loaded
2. Start recording
3. Click Run on the first cell (small import)
4. Click Run on the second cell (creates large DataFrame) - memory delta appears
5. Click Run on the third cell (creates numpy array) - memory delta appears
6. Click the "x=" sidebar button to open Variable Inspector
7. Show the variables sorted by size
8. Optional: delete the large variable, show RAM drop
9. Stop recording

## GIF 2: Feature Tour (12-18s)

1. Start with a notebook open, cells already executed
2. Start recording
3. Show outputs (table, text)
4. Open Settings, toggle to Dark mode, close settings
5. Click sidebar variable inspector
6. Click sidebar terminal button
7. Type a command in terminal
8. Hover over a cell, click the "?" AI explain button (if configured)
9. Stop recording

## GIF 3: Per-Cell Memory Tracking (5-8s)

1. Open `demo_memory.ipynb`
2. Start recording
3. Run cell that imports pandas (small delta: ~2 MB)
4. Run cell that creates a 1M-row DataFrame (large delta: ~80 MB)
5. Run cell that creates a numpy array (medium delta: ~40 MB)
6. Pause to show the different colored deltas
7. Stop recording

## GIF 4: Variable Inspector (6-10s)

1. Have variables already loaded (DataFrame, array, list, etc.)
2. Start recording
3. Open variable inspector sidebar
4. Click "Size" header to sort by size
5. Show the category breakdown bar
6. Click delete on a variable
7. Inspector updates
8. Stop recording

## GIF 5: Cold Start Comparison (8-10s)

1. Close both Saturn and JupyterLab Desktop
2. Arrange two desktop areas side by side (or use split screen recording)
3. Start recording
4. Launch both simultaneously (click both icons at the same moment)
5. Saturn window appears first (3s), JupyterLab takes longer (8s)
6. Wait until both are fully loaded
7. Stop recording

## GIF 6: Memory Visibility Comparison (6-10s)

1. Open the same notebook in both Saturn and JupyterLab
2. Start recording
3. Run the same cell in both (one that creates a large DataFrame)
4. Saturn: per-cell delta appears, variable inspector shows sizes
5. JupyterLab: just the output, no memory info
6. Stop recording

## Screenshots

For each, use the demo notebook with cells executed:

1. **saturn-light.png**: Full window, light mode, notebook with outputs visible
2. **saturn-dark.png**: Same notebook, dark mode
3. **variable-inspector.png**: Sidebar open showing inspector with DataFrame
4. **stale-cells.png**: Open `test_smart_cells.ipynb`, run cells to trigger stale indicators
5. **ai-panel.png**: Hover cell, click "?", show AI panel (needs provider configured)
6. **terminal.png**: Click terminal icon, show terminal with a command
7. **widgets.png**: Open `test_anywidget.ipynb`, run counter widget
8. **settings.png**: Open settings panel

Save all PNGs to `assets/screenshots/`, GIFs to `assets/gifs/`.
