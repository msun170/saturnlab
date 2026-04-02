# Memory Tooling Patterns

## Variable Inspector — Kernel Introspection

Send as a **silent execution** (no output shown to user, no execution count increment):

```json
{
  "content": {
    "code": "<introspection_code>",
    "silent": true,
    "store_history": false,
    "user_expressions": {},
    "allow_stdin": false
  }
}
```

### Basic Variable Inspection

```python
import sys, json
_saturn_vars = {}
for _name, _obj in list(globals().items()):
    if not _name.startswith('_') and not callable(_obj) and not _name.startswith('__'):
        try:
            _saturn_vars[_name] = {
                'type': type(_obj).__name__,
                'size': sys.getsizeof(_obj),
            }
        except Exception:
            _saturn_vars[_name] = {
                'type': type(_obj).__name__,
                'size': -1,
            }
import json as _json
print(_json.dumps(_saturn_vars))
```

### Deep Size for DataFrames and Arrays

`sys.getsizeof()` only returns the container size, not the data. For pandas/numpy:

```python
import sys, json
_saturn_vars = {}
for _name, _obj in list(globals().items()):
    if not _name.startswith('_') and not callable(_obj):
        _type = type(_obj).__name__
        try:
            if _type == 'DataFrame':
                _size = _obj.memory_usage(deep=True).sum()
            elif _type == 'ndarray':
                _size = _obj.nbytes
            elif _type == 'Series':
                _size = _obj.memory_usage(deep=True)
            elif _type in ('list', 'dict', 'set', 'tuple'):
                _size = sys.getsizeof(_obj)  # shallow only for containers
            else:
                _size = sys.getsizeof(_obj)
            _saturn_vars[_name] = {
                'type': _type,
                'size': int(_size),
                'shape': str(getattr(_obj, 'shape', '')),
                'dtype': str(getattr(_obj, 'dtype', '')),
            }
        except Exception:
            _saturn_vars[_name] = {'type': _type, 'size': -1}
print(json.dumps(_saturn_vars))
```

### One-Click Variable Clearing

Send via silent execution:
```python
del variable_name
```

Or for multiple:
```python
for _name in ['df', 'X_train', 'model']:
    if _name in globals():
        del globals()[_name]
import gc; gc.collect()
```

## OS-Level Memory Monitoring (Rust)

Track the kernel process PID (obtained at spawn time):

```rust
use sysinfo::{System, Pid, ProcessRefreshKind, MemoryRefreshKind};

pub struct MemoryMonitor {
    sys: System,
}

impl MemoryMonitor {
    pub fn new() -> Self {
        Self { sys: System::new() }
    }

    /// Returns (process_rss_bytes, system_total_bytes, system_available_bytes)
    pub fn get_kernel_memory(&mut self, pid: u32) -> Option<(u64, u64, u64)> {
        self.sys.refresh_memory_specifics(MemoryRefreshKind::new().with_ram());
        self.sys.refresh_process_specifics(
            Pid::from(pid as usize),
            ProcessRefreshKind::new().with_memory(),
        );

        let process_mem = self.sys
            .process(Pid::from(pid as usize))
            .map(|p| p.memory())?;

        Some((
            process_mem,
            self.sys.total_memory(),
            self.sys.available_memory(),
        ))
    }
}
```

Poll this every 2-5 seconds via a Tauri event:
```rust
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(3));
    loop {
        interval.tick().await;
        if let Some((rss, total, available)) = monitor.get_kernel_memory(pid) {
            app_handle.emit("memory-update", MemoryInfo { kernel_id, rss, total, available }).ok();
        }
    }
});
```

## Unused Variable Detection

Track which variables are referenced in executed cells:

```typescript
// Frontend: track variable references per cell execution
interface CellExecution {
  cellId: string;
  executionCount: number;
  referencedVars: Set<string>; // parsed from the code
}

// After N executions, flag variables not referenced in the last M cells
function findUnusedVars(
  allVars: string[],
  recentExecutions: CellExecution[],
  lookbackCount: number = 10,
): string[] {
  const recent = recentExecutions.slice(-lookbackCount);
  const recentlyUsed = new Set(recent.flatMap(e => [...e.referencedVars]));
  return allVars.filter(v => !recentlyUsed.has(v));
}
```

## Memory Warning Thresholds

```typescript
interface MemoryConfig {
  warningThreshold: number;  // 0.7 = 70%
  criticalThreshold: number; // 0.9 = 90%
}

function checkMemory(rss: number, available: number, total: number, config: MemoryConfig) {
  const usedRatio = 1 - (available / total);
  if (usedRatio >= config.criticalThreshold) {
    return { level: 'critical', message: `System memory at ${(usedRatio * 100).toFixed(0)}%` };
  }
  if (usedRatio >= config.warningThreshold) {
    return { level: 'warning', message: `System memory at ${(usedRatio * 100).toFixed(0)}%` };
  }
  return { level: 'ok' };
}
```

## "Restart Kernel, Keep Outputs" Pattern

1. Save all current cell outputs in React state (they're already there)
2. Send `shutdown_request` to kernel
3. Wait for process exit
4. Start a new kernel
5. Outputs remain visible in the UI (they're stored in the notebook's cell data)
6. Execution counts reset to `null`
7. Variable inspector clears (kernel state is gone)
