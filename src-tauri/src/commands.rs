use crate::kernel::discovery::KernelSpec;
use crate::kernel::manager::{KernelInfo, KernelManager};
use crate::kernel::message::JupyterMessage;
use crate::kernel::zmq_client::{IopubListener, ShellClient};
use zeromq::SocketRecv;
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

/// Manages persistent ZMQ connections per kernel.
/// ShellClient for sending requests, IopubListener (exactly ONE) for receiving outputs.
pub struct ZmqPool {
    shells: Arc<RwLock<HashMap<String, Arc<tokio::sync::Mutex<ShellClient>>>>>,
}

impl ZmqPool {
    pub fn new() -> Self {
        Self {
            shells: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get or create a shell connection for a kernel, and start the iopub listener if new.
    pub async fn get_or_connect(
        &self,
        kernel_id: &str,
        manager: &KernelManager,
        app: &tauri::AppHandle,
    ) -> Result<Arc<tokio::sync::Mutex<ShellClient>>, String> {
        // Check if we already have a connection
        {
            let conns = self.shells.read().await;
            if let Some(client) = conns.get(kernel_id) {
                return Ok(client.clone());
            }
        }

        let conn_info = manager.get_connection_info(kernel_id).await?;

        // Create shell-only connection (no iopub socket)
        let shell = ShellClient::connect(conn_info.clone()).await?;
        let client = Arc::new(tokio::sync::Mutex::new(shell));

        // Store it
        {
            let mut conns = self.shells.write().await;
            conns.insert(kernel_id.to_string(), client.clone());
        }

        // Start exactly ONE iopub listener for this kernel
        let kernel_id_owned = kernel_id.to_string();
        let app_handle = app.clone();
        let conn_for_iopub = conn_info.clone();
        tokio::spawn(async move {
            let mut listener = match IopubListener::connect(conn_for_iopub).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Failed to connect iopub for {}: {}", kernel_id_owned, e);
                    return;
                }
            };

            loop {
                match listener.recv().await {
                    Ok(reply) => {
                        let msg_type = reply.header.msg_type.clone();
                        let parent_id = reply
                            .parent_header
                            .get("msg_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        let output = KernelOutput {
                            kernel_id: kernel_id_owned.clone(),
                            msg_type: msg_type.clone(),
                            content: reply.content.clone(),
                            parent_msg_id: parent_id,
                        };

                        let _ = app_handle.emit("kernel-output", &output);
                    }
                    Err(e) => {
                        eprintln!("IOPub error for {}: {}", kernel_id_owned, e);
                        break;
                    }
                }
            }
        });

        Ok(client)
    }

    /// Remove connection when kernel is stopped.
    pub async fn disconnect(&self, kernel_id: &str) {
        let mut conns = self.shells.write().await;
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

    // Give the kernel a moment to start up
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    // Pre-connect and start the iopub listener
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

#[tauri::command]
pub async fn execute_code(
    app: tauri::AppHandle,
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    kernel_id: String,
    code: String,
    silent: bool,
) -> Result<String, String> {
    let session = manager.get_session_id(&kernel_id).await?;
    let client = pool.get_or_connect(&kernel_id, &manager, &app).await?;

    // Create and send execute_request on the shell channel
    let msg = JupyterMessage::execute_request(&session, &code, silent);
    let msg_id = msg.header.msg_id.clone();

    {
        let mut zmq = client.lock().await;
        zmq.send_shell(&msg).await?;
    }

    // Read execute_reply from shell to get execution_count
    // Do this in a spawned task so we don't block the IPC call
    let kernel_id_clone = kernel_id.clone();
    let msg_id_clone = msg_id.clone();
    let client_clone = client.clone();
    tokio::spawn(async move {
        // Wait a bit for the kernel to process, then read the reply
        let mut zmq = client_clone.lock().await;
        // The shell socket is DEALER, so we receive the reply directly
        match tokio::time::timeout(
            std::time::Duration::from_secs(300),
            zmq.shell.recv(),
        ).await {
            Ok(Ok(reply_msg)) => {
                let frames: Vec<Vec<u8>> = reply_msg.into_vec().iter().map(|f| f.to_vec()).collect();
                if let Ok(reply) = JupyterMessage::from_wire_frames(&frames, zmq.connection.key.as_bytes()) {
                    if reply.header.msg_type == "execute_reply" {
                        let output = KernelOutput {
                            kernel_id: kernel_id_clone,
                            msg_type: "execute_reply".to_string(),
                            content: reply.content,
                            parent_msg_id: msg_id_clone,
                        };
                        let _ = app.emit("kernel-output", &output);
                    }
                }
            }
            _ => {}
        }
    });

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
