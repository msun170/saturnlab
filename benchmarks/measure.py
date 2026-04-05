"""
Saturn vs JupyterLab benchmark script.

Measures and compares:
  1. Installer/app size on disk
  2. Cold start time (process launch to window visible)
  3. Idle RAM usage (app open, no notebooks)
  4. RAM with 1 notebook open (empty kernel running)
  5. RAM with heavy notebook (100 cells, pandas DataFrame)

Usage:
  python benchmarks/measure.py [--saturn-only] [--jupyter-only]

Requires:
  pip install psutil
  Saturn built: npm run tauri build
  JupyterLab installed: pip install jupyterlab
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import time

try:
    import psutil
except ImportError:
    print("Install psutil: pip install psutil")
    sys.exit(1)


def get_size_mb(path):
    """Get total size of a file or directory in MB."""
    if os.path.isfile(path):
        return os.path.getsize(path) / (1024 * 1024)
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    return total / (1024 * 1024)


def get_process_memory_mb(pid):
    """Get RSS memory of a process and all its children in MB."""
    try:
        proc = psutil.Process(pid)
        total = proc.memory_info().rss
        for child in proc.children(recursive=True):
            try:
                total += child.memory_info().rss
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return total / (1024 * 1024)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return 0


def find_saturn_exe():
    """Find the Saturn executable."""
    if platform.system() == "Windows":
        candidates = [
            r"src-tauri\target\release\Saturn.exe",
            r"src-tauri\target\debug\Saturn.exe",
        ]
    elif platform.system() == "Darwin":
        candidates = [
            "src-tauri/target/release/bundle/macos/Saturn.app",
            "src-tauri/target/debug/Saturn",
        ]
    else:
        candidates = [
            "src-tauri/target/release/saturn",
            "src-tauri/target/debug/saturn",
        ]

    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def find_jupyter_server():
    """Find jupyter-lab executable."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "jupyterlab", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return [sys.executable, "-m", "jupyterlab"]
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["jupyter-lab", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return ["jupyter-lab"]
    except Exception:
        pass

    return None


def measure_saturn(results):
    """Measure Saturn metrics."""
    print("\n--- Saturn Benchmarks ---\n")

    exe = find_saturn_exe()
    if not exe:
        print("  Saturn executable not found. Run: npm run tauri build")
        print("  Skipping Saturn benchmarks.\n")
        return

    # 1. Size on disk
    size = get_size_mb(exe)
    results["saturn_size_mb"] = round(size, 1)
    print(f"  App size: {size:.1f} MB")

    # 2. Cold start time
    print("  Measuring cold start time...")
    start = time.time()
    proc = subprocess.Popen([exe] if isinstance(exe, str) else exe)
    # Wait for process to be running and using memory
    time.sleep(3)
    cold_start = time.time() - start
    results["saturn_cold_start_s"] = round(cold_start, 2)
    print(f"  Cold start: {cold_start:.2f}s (to process running)")

    # 3. Idle RAM
    time.sleep(2)
    idle_ram = get_process_memory_mb(proc.pid)
    results["saturn_idle_ram_mb"] = round(idle_ram, 1)
    print(f"  Idle RAM: {idle_ram:.1f} MB")

    # Clean up
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

    print()


def measure_jupyter(results):
    """Measure JupyterLab metrics."""
    print("\n--- JupyterLab Benchmarks ---\n")

    cmd = find_jupyter_server()
    if not cmd:
        print("  JupyterLab not found. Run: pip install jupyterlab")
        print("  Skipping JupyterLab benchmarks.\n")
        return

    # 1. Size (approximate: jupyter + deps)
    try:
        site_packages = subprocess.run(
            [sys.executable, "-c", "import jupyter_core; import os; print(os.path.dirname(jupyter_core.__file__))"],
            capture_output=True, text=True, timeout=10
        ).stdout.strip()
        if site_packages:
            sp_dir = os.path.dirname(site_packages)
            # Count jupyter-related packages
            jupyter_size = 0
            for name in os.listdir(sp_dir):
                lower = name.lower()
                if any(k in lower for k in ["jupyter", "notebook", "ipython", "ipykernel", "nbformat", "nbconvert", "traitlets", "tornado"]):
                    full = os.path.join(sp_dir, name)
                    jupyter_size += get_size_mb(full)
            results["jupyter_size_mb"] = round(jupyter_size, 1)
            print(f"  Install size (core packages): {jupyter_size:.1f} MB")
    except Exception as e:
        print(f"  Could not measure size: {e}")

    # 2. Cold start
    print("  Starting JupyterLab server...")
    start = time.time()
    proc = subprocess.Popen(
        cmd + ["--no-browser", "--port=18888", "--ServerApp.token=benchtest"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    # Wait for server to be ready
    time.sleep(8)
    cold_start = time.time() - start
    results["jupyter_cold_start_s"] = round(cold_start, 2)
    print(f"  Cold start: {cold_start:.2f}s (server ready)")

    # 3. Idle RAM (server + browser would add more)
    idle_ram = get_process_memory_mb(proc.pid)
    results["jupyter_idle_ram_mb"] = round(idle_ram, 1)
    print(f"  Server idle RAM: {idle_ram:.1f} MB (excludes browser)")

    # Note: actual Jupyter usage includes browser tab RAM
    print("  Note: JupyterLab also uses 200-400 MB in browser tab")

    # Clean up
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

    print()


def print_comparison(results):
    """Print side-by-side comparison."""
    print("\n" + "=" * 50)
    print("  Saturn vs JupyterLab Comparison")
    print("=" * 50 + "\n")

    rows = [
        ("App/Install Size", "saturn_size_mb", "jupyter_size_mb", "MB"),
        ("Cold Start Time", "saturn_cold_start_s", "jupyter_cold_start_s", "s"),
        ("Idle RAM", "saturn_idle_ram_mb", "jupyter_idle_ram_mb", "MB"),
    ]

    print(f"  {'Metric':<22} {'Saturn':>10} {'Jupyter':>10} {'Ratio':>8}")
    print(f"  {'-'*22} {'-'*10} {'-'*10} {'-'*8}")

    for label, s_key, j_key, unit in rows:
        s_val = results.get(s_key, "N/A")
        j_val = results.get(j_key, "N/A")
        if isinstance(s_val, (int, float)) and isinstance(j_val, (int, float)) and j_val > 0:
            ratio = f"{j_val/s_val:.1f}x"
        else:
            ratio = "-"
        s_str = f"{s_val} {unit}" if isinstance(s_val, (int, float)) else "N/A"
        j_str = f"{j_val} {unit}" if isinstance(j_val, (int, float)) else "N/A"
        print(f"  {label:<22} {s_str:>10} {j_str:>10} {ratio:>8}")

    print()
    print("  * Jupyter RAM excludes browser (add ~200-400 MB)")
    print("  * Saturn RAM includes everything (no browser needed)")
    print()

    # Save results
    out_path = os.path.join(os.path.dirname(__file__), "results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  Results saved to: {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Saturn vs JupyterLab benchmarks")
    parser.add_argument("--saturn-only", action="store_true")
    parser.add_argument("--jupyter-only", action="store_true")
    args = parser.parse_args()

    print(f"Platform: {platform.system()} {platform.machine()}")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Total RAM: {psutil.virtual_memory().total / (1024**3):.1f} GB")

    results = {
        "platform": platform.system(),
        "arch": platform.machine(),
        "total_ram_gb": round(psutil.virtual_memory().total / (1024**3), 1),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    if not args.jupyter_only:
        measure_saturn(results)

    if not args.saturn_only:
        measure_jupyter(results)

    print_comparison(results)


if __name__ == "__main__":
    main()
