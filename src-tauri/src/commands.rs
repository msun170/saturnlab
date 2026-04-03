use crate::kernel::discovery::KernelSpec;
use crate::kernel::manager::{KernelInfo, KernelManager};
use crate::kernel::message::JupyterMessage;
use crate::kernel::zmq_client::{IopubListener, ShellClient};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::RwLock;

/// Frontend-friendly kernel output event.
#[derive(Debug, Clone, Serialize)]
pub struct KernelOutput {
    pub kernel_id: String,
    pub msg_type: String,
    pub content: serde_json::Value,
    pub parent_msg_id: String,
}

/// One shell sender + one iopub listener per kernel. That's it.
/// No shell reply reader. The iopub channel gives us everything we need:
/// stream, display_data, execute_result (with execution_count), error, status.
pub struct ZmqPool {
    senders: Arc<RwLock<HashMap<String, Arc<tokio::sync::Mutex<ShellClient>>>>>,
}

impl ZmqPool {
    pub fn new() -> Self {
        Self {
            senders: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_or_connect(
        &self,
        kernel_id: &str,
        manager: &KernelManager,
        app: &tauri::AppHandle,
    ) -> Result<Arc<tokio::sync::Mutex<ShellClient>>, String> {
        {
            let conns = self.senders.read().await;
            if let Some(client) = conns.get(kernel_id) {
                return Ok(client.clone());
            }
        }

        let conn_info = manager.get_connection_info(kernel_id).await?;

        let shell = ShellClient::connect(conn_info.clone()).await?;
        let client = Arc::new(tokio::sync::Mutex::new(shell));

        {
            let mut conns = self.senders.write().await;
            conns.insert(kernel_id.to_string(), client.clone());
        }

        // ONE iopub listener per kernel. This is the only message receiver.
        let kid = kernel_id.to_string();
        let app1 = app.clone();
        let conn1 = conn_info.clone();
        tokio::spawn(async move {
            let mut listener = match IopubListener::connect(conn1).await {
                Ok(l) => l,
                Err(e) => { eprintln!("iopub connect failed: {}", e); return; }
            };
            loop {
                match listener.recv().await {
                    Ok(msg) => {
                        let parent_id = msg.parent_header
                            .get("msg_id").and_then(|v| v.as_str())
                            .unwrap_or("").to_string();
                                        let _ = app1.emit("kernel-output", &KernelOutput {
                            kernel_id: kid.clone(),
                            msg_type: msg.header.msg_type.clone(),
                            content: msg.content.clone(),
                            parent_msg_id: parent_id,
                        });
                    }
                    Err(e) => { eprintln!("iopub error: {}", e); break; }
                }
            }
        });

        Ok(client)
    }

    pub async fn disconnect(&self, kernel_id: &str) {
        let mut conns = self.senders.write().await;
        conns.remove(kernel_id);
    }
}

// ─── Kernel Management ───────────────────────────────────────────────

#[tauri::command]
pub fn list_kernelspecs(manager: State<'_, KernelManager>) -> Vec<KernelSpec> {
    manager.list_kernelspecs()
}

#[tauri::command]
pub async fn start_kernel(
    app: tauri::AppHandle,
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    spec_name: String,
) -> Result<String, String> {
    let kernel_id = manager.start_kernel(&spec_name).await?;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    pool.get_or_connect(&kernel_id, &manager, &app).await?;
    Ok(kernel_id)
}

#[tauri::command]
pub async fn stop_kernel(
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    kernel_id: String,
) -> Result<(), String> {
    pool.disconnect(&kernel_id).await;
    manager.stop_kernel(&kernel_id).await
}

#[tauri::command]
pub async fn interrupt_kernel(
    manager: State<'_, KernelManager>,
    kernel_id: String,
) -> Result<(), String> {
    manager.interrupt_kernel(&kernel_id).await
}

#[tauri::command]
pub async fn list_running_kernels(manager: State<'_, KernelManager>) -> Result<Vec<KernelInfo>, String> {
    Ok(manager.list_kernels().await)
}

// ─── Code Execution ──────────────────────────────────────────────────
// Just send on shell, return msg_id. That's it.
// The iopub listener handles all output routing.
// This is exactly what jupyter_client.KernelClient.execute() does.

#[tauri::command]
pub async fn execute_code(
    app: tauri::AppHandle,
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    kernel_id: String,
    code: String,
    silent: bool,
    msg_id: Option<String>,
) -> Result<String, String> {
    let session = manager.get_session_id(&kernel_id).await?;
    let client = pool.get_or_connect(&kernel_id, &manager, &app).await?;

    let mut msg = JupyterMessage::execute_request(&session, &code, silent);
    // If frontend provided a msg_id, use it so the pending map is already set
    if let Some(id) = msg_id {
        msg.header.msg_id = id;
    }
    let msg_id = msg.header.msg_id.clone();

    {
        let mut zmq = client.lock().await;
        zmq.send_shell(&msg).await?;
    }

    Ok(msg_id)
}

// ─── Notebook I/O ────────────────────────────────────────────────────

#[tauri::command]
pub fn read_notebook(path: String) -> Result<crate::notebook::format::Notebook, String> {
    crate::notebook::io::read_notebook(std::path::Path::new(&path))
}

#[tauri::command]
pub fn write_notebook(
    path: String,
    notebook: crate::notebook::format::Notebook,
) -> Result<(), String> {
    crate::notebook::io::write_notebook(std::path::Path::new(&path), &notebook)
}

// ─── Filesystem ──────────────────────────────────────────────────────

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<crate::filesystem::FileEntry>, String> {
    crate::filesystem::list_directory(&path)
}

#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    crate::filesystem::get_cwd()
}
