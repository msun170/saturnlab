# Rust Backend Patterns

## Tauri v2 Command Pattern

All IPC commands live in `src-tauri/src/commands.rs` and delegate to module functions:

```rust
use tauri::State;
use crate::kernel::KernelManager;

#[tauri::command]
async fn start_kernel(
    manager: State<'_, KernelManager>,
    kernelspec_name: String,
) -> Result<String, String> {
    manager
        .start(&kernelspec_name)
        .await
        .map(|k| k.id.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn execute_cell(
    manager: State<'_, KernelManager>,
    kernel_id: String,
    code: String,
) -> Result<(), String> {
    let kernel = manager.get(&kernel_id).map_err(|e| e.to_string())?;
    kernel.execute(&code).await.map_err(|e| e.to_string())
}
```

Register in `main.rs`:
```rust
fn main() {
    tauri::Builder::default()
        .manage(KernelManager::new())
        .invoke_handler(tauri::generate_handler![
            start_kernel,
            execute_cell,
            stop_kernel,
            interrupt_kernel,
            // ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Module Organization

Each module has `mod.rs` that re-exports public items:

```
kernel/
  mod.rs          -> pub mod manager; pub mod zmq_client; pub mod message; pub mod discovery;
  manager.rs      -> KernelManager struct, start/stop/get/list
  zmq_client.rs   -> ZmqClient struct, 5-channel connection, send/receive
  message.rs      -> JupyterMessage, Header, Content enums
  discovery.rs    -> find_kernelspecs(), scan_conda_envs(), scan_virtualenvs()
```

## Error Handling

Library errors use `thiserror`:
```rust
#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("Kernel not found: {0}")]
    NotFound(String),
    #[error("ZMQ communication error: {0}")]
    Zmq(#[from] zeromq::ZmqError),
    #[error("Kernel process exited unexpectedly")]
    ProcessDied,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
```

Commands convert to `String` for the frontend:
```rust
.map_err(|e| e.to_string())
```

## Async Patterns with Tokio

Kernel message listening runs as a spawned task:
```rust
pub async fn listen_iopub(&self, app_handle: tauri::AppHandle) {
    let mut socket = self.iopub_socket.clone();
    tokio::spawn(async move {
        loop {
            match socket.recv().await {
                Ok(msg) => {
                    let parsed = JupyterMessage::from_zmq(msg);
                    app_handle.emit("kernel-message", &parsed).ok();
                }
                Err(e) => {
                    eprintln!("iopub recv error: {}", e);
                    break;
                }
            }
        }
    });
}
```

## sysinfo for Process Monitoring

```rust
use sysinfo::{System, Pid, ProcessRefreshKind};

pub fn get_process_memory(pid: u32) -> Option<u64> {
    let mut sys = System::new();
    sys.refresh_process_specifics(
        Pid::from(pid as usize),
        ProcessRefreshKind::new().with_memory(),
    );
    sys.process(Pid::from(pid as usize))
        .map(|p| p.memory()) // bytes
}
```

## State Management

Use Tauri's `State` for shared mutable state:
```rust
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct KernelManager {
    kernels: Arc<RwLock<HashMap<String, Kernel>>>,
}
```
