use crate::kernel::discovery::KernelSpec;
use crate::kernel::manager::{KernelInfo, KernelManager};
use crate::kernel::message::JupyterMessage;
use crate::kernel::zmq_client::ZmqClient;
use serde::Serialize;
use tauri::{Emitter, State};

/// Frontend-friendly kernel output event.
#[derive(Debug, Clone, Serialize)]
pub struct KernelOutput {
    pub kernel_id: String,
    pub msg_type: String,
    pub content: serde_json::Value,
    pub parent_msg_id: String,
}

// ─── Kernel Management ───────────────────────────────────────────────

#[tauri::command]
pub fn list_kernelspecs(manager: State<'_, KernelManager>) -> Vec<KernelSpec> {
    manager.list_kernelspecs()
}

#[tauri::command]
pub async fn start_kernel(
    manager: State<'_, KernelManager>,
    spec_name: String,
) -> Result<String, String> {
    let kernel_id = manager.start_kernel(&spec_name).await?;

    // Give the kernel a moment to start up
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    Ok(kernel_id)
}

#[tauri::command]
pub async fn stop_kernel(
    manager: State<'_, KernelManager>,
    kernel_id: String,
) -> Result<(), String> {
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
    kernel_id: String,
    code: String,
    silent: bool,
) -> Result<String, String> {
    let conn = manager.get_connection_info(&kernel_id).await?;
    let session = manager.get_session_id(&kernel_id).await?;

    let mut zmq = ZmqClient::connect(conn).await?;

    // Create and send execute_request
    let msg = JupyterMessage::execute_request(&session, &code, silent);
    let msg_id = msg.header.msg_id.clone();
    zmq.send_shell(&msg).await?;

    // Spawn a task to listen for iopub messages and emit them to the frontend
    let kernel_id_clone = kernel_id.clone();
    let msg_id_clone = msg_id.clone();
    tokio::spawn(async move {
        loop {
            match zmq.recv_iopub().await {
                Ok(reply) => {
                    let msg_type = reply.header.msg_type.clone();

                    // Get parent msg_id to correlate with our request
                    let parent_id = reply
                        .parent_header
                        .get("msg_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let output = KernelOutput {
                        kernel_id: kernel_id_clone.clone(),
                        msg_type: msg_type.clone(),
                        content: reply.content.clone(),
                        parent_msg_id: parent_id.clone(),
                    };

                    // Emit to frontend
                    let _ = app.emit("kernel-output", &output);

                    // Stop listening after kernel goes idle for our message
                    if msg_type == "status" {
                        if let Some(state) = reply.content.get("execution_state") {
                            if state == "idle" && parent_id == msg_id_clone {
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("IOPub error: {}", e);
                    break;
                }
            }
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
