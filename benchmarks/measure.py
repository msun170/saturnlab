"""
Saturn vs JupyterLab Desktop - Memory Benchmark (Manual)

Guides you through reading memory from Task Manager at each step.
Uses the same notebook for all tests.

Usage:
  python benchmarks/measure.py

How to read memory in Task Manager:
  1. Open Task Manager (Ctrl+Shift+Esc)
  2. Go to the "Details" tab (not "Processes")
  3. Click "Memory (private working set)" column to sort
  4. For Saturn: add up saturn.exe + all msedgewebview2.exe processes
  5. For JupyterLab Desktop: add up jlab.exe + all its sub-processes
  6. Do NOT count the python.exe kernel process (it's the same for both)
"""

import json
import os
import platform
import time


def ask_mb(prompt):
    """Ask user to enter a memory reading in MB."""
    while True:
        val = input(f"\n  {prompt}\n  Enter MB (from Task Manager): ").strip()
        if not val:
            return None
        try:
            return float(val)
        except ValueError:
            print("  Please enter a number (e.g. 45.2)")


def run():
    print("=" * 60)
    print("  Saturn vs JupyterLab Desktop - Memory Benchmark")
    print("=" * 60)
    print(f"  Platform: {platform.system()} {platform.machine()}")
    print(f"  Notebook: demo_memory.ipynb")
    print()
    print("  IMPORTANT: Use Task Manager > Details tab")
    print("  For Saturn: add saturn.exe + msedgewebview2.exe processes")
    print("  For JupyterLab: add jlab.exe + its sub-processes")
    print("  Do NOT count python.exe (kernel) - same for both apps")

    results = {
        "platform": platform.system(),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    # ─── Saturn ───────────────────────────────────────────────

    print("\n" + "-" * 60)
    print("  SATURN")
    print("-" * 60)

    results["saturn_idle"] = ask_mb(
        "Open Saturn (launcher only, no notebook).\n"
        "  In Task Manager Details, add up saturn.exe + msedgewebview2.exe."
    )

    results["saturn_notebook"] = ask_mb(
        "Open demo_memory.ipynb. Start kernel. Do NOT run cells.\n"
        "  Same: saturn.exe + msedgewebview2.exe (still no python.exe)."
    )

    results["saturn_executed"] = ask_mb(
        "Run ALL cells. Wait for them to finish.\n"
        "  Same: saturn.exe + msedgewebview2.exe only (not python.exe)."
    )

    results["saturn_kernel"] = ask_mb(
        "Now check: how much is python.exe using?\n"
        "  (This is the kernel - same process for both apps.)"
    )

    # ─── JupyterLab Desktop ──────────────────────────────────

    print("\n" + "-" * 60)
    print("  JUPYTERLAB DESKTOP")
    print("-" * 60)

    results["jupyter_idle"] = ask_mb(
        "Close Saturn. Open JupyterLab Desktop (no notebook).\n"
        "  Add up jlab.exe + all its sub-processes in Details tab."
    )

    results["jupyter_notebook"] = ask_mb(
        "Open the SAME demo_memory.ipynb. Start kernel. Do NOT run cells.\n"
        "  Same: jlab.exe + sub-processes (not python.exe)."
    )

    results["jupyter_executed"] = ask_mb(
        "Run ALL cells. Wait for them to finish.\n"
        "  Same: jlab.exe + sub-processes only (not python.exe)."
    )

    results["jupyter_kernel"] = ask_mb(
        "Now check: how much is python.exe using?\n"
        "  (Should be similar to Saturn's kernel.)"
    )

    # ─── Results ──────────────────────────────────────────────

    print("\n" + "=" * 60)
    print("  RESULTS (app memory only, kernel excluded)")
    print("=" * 60)

    rows = [
        ("Idle (no notebook)", "saturn_idle", "jupyter_idle"),
        ("Notebook open + kernel", "saturn_notebook", "jupyter_notebook"),
        ("After running all cells", "saturn_executed", "jupyter_executed"),
    ]

    print(f"\n  {'Step':<30} {'Saturn':>10} {'JL Desktop':>12} {'Ratio':>8}")
    print(f"  {'-'*30} {'-'*10} {'-'*12} {'-'*8}")

    for label, s_key, j_key in rows:
        s = results.get(s_key)
        j = results.get(j_key)
        s_str = f"{s} MB" if s else "N/A"
        j_str = f"{j} MB" if j else "N/A"
        ratio = f"{j/s:.1f}x" if s and j and s > 0 else ""
        print(f"  {label:<30} {s_str:>10} {j_str:>12} {ratio:>8}")

    sk = results.get("saturn_kernel")
    jk = results.get("jupyter_kernel")
    if sk or jk:
        print(f"\n  Kernel (python.exe): Saturn={sk} MB, JupyterLab={jk} MB")

    # Markdown
    print("\n  --- Markdown for README ---")
    print()
    print("  | Step | Saturn | JupyterLab Desktop |")
    print("  |------|--------|-------------------|")
    for label, s_key, j_key in rows:
        s = results.get(s_key)
        j = results.get(j_key)
        print(f"  | {label} | {s} MB | {j} MB |")

    # Save
    out = os.path.join(os.path.dirname(__file__), "results.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Saved to: {out}")


if __name__ == "__main__":
    run()
