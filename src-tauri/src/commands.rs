use crate::kernel::discovery::KernelSpec;
use crate::kernel::manager::{KernelInfo, KernelManager};
use crate::kernel::message::JupyterMessage;
use crate::kernel::zmq_client::{IopubListener, ShellClient};
use zeromq::SocketRecv;
use crate::memory::monitor::{MemoryInfo, MemoryMonitor};
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

// ─── Remote helpers ─────────────────────────────────────────────────

fn get_remote_client() -> Option<crate::kernel::remote::RemoteClient> {
    let settings = crate::settings::read_settings();
    if settings.remote_server_url.is_empty() || settings.remote_token.is_empty() {
        return None;
    }
    Some(crate::kernel::remote::RemoteClient::new(
        &settings.remote_server_url,
        &settings.remote_token,
    ))
}

// ─── Kernel Management ───────────────────────────────────────────────

#[tauri::command]
pub async fn list_kernelspecs(manager: State<'_, KernelManager>) -> Result<Vec<KernelSpec>, String> {
    if let Some(remote) = get_remote_client() {
        return remote.list_kernelspecs().await;
    }
    Ok(manager.list_kernelspecs())
}

#[tauri::command]
pub async fn start_kernel(
    app: tauri::AppHandle,
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    spec_name: String,
) -> Result<String, String> {
    if let Some(remote) = get_remote_client() {
        let info = remote.start_kernel(&spec_name).await?;
        let ws_url = remote.ws_url(&info.id);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        ws_pool.connect(&info.id, &ws_url, app).await?;
        return Ok(info.id);
    }
    let kernel_id = manager.start_kernel(&spec_name).await?;
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    pool.get_or_connect(&kernel_id, &manager, &app).await?;
    Ok(kernel_id)
}

#[tauri::command]
pub async fn stop_kernel(
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
) -> Result<(), String> {
    if let Some(remote) = get_remote_client() {
        ws_pool.disconnect(&kernel_id).await;
        return remote.stop_kernel(&kernel_id).await;
    }
    pool.disconnect(&kernel_id).await;
    manager.stop_kernel(&kernel_id).await
}

#[tauri::command]
pub async fn interrupt_kernel(
    manager: State<'_, KernelManager>,
    kernel_id: String,
) -> Result<(), String> {
    if let Some(remote) = get_remote_client() {
        return remote.interrupt_kernel(&kernel_id).await;
    }
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
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
    code: String,
    silent: bool,
    msg_id: Option<String>,
) -> Result<String, String> {
    // Build the message (session can be random UUID for remote)
    let session = if get_remote_client().is_some() {
        uuid::Uuid::new_v4().to_string()
    } else {
        manager.get_session_id(&kernel_id).await?
    };

    let mut msg = JupyterMessage::execute_request(&session, &code, silent);
    if let Some(id) = msg_id {
        msg.header.msg_id = id;
    }
    let msg_id = msg.header.msg_id.clone();

    // Route via WebSocket or ZMQ
    if ws_pool.is_connected(&kernel_id).await {
        ws_pool.send_shell(&kernel_id, &msg).await?;
    } else {
        let client = pool.get_or_connect(&kernel_id, &manager, &app).await?;
        let mut zmq = client.lock().await;
        zmq.send_shell(&msg).await?;
    }

    Ok(msg_id)
}

// ─── Widget Comm ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_comm_msg(
    app: tauri::AppHandle,
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
    comm_id: String,
    data: serde_json::Value,
) -> Result<String, String> {
    let session = if get_remote_client().is_some() {
        uuid::Uuid::new_v4().to_string()
    } else {
        manager.get_session_id(&kernel_id).await?
    };

    let msg = JupyterMessage::new(
        "comm_msg",
        &session,
        serde_json::json!({
            "comm_id": comm_id,
            "data": data,
        }),
    );
    let msg_id = msg.header.msg_id.clone();

    if ws_pool.is_connected(&kernel_id).await {
        ws_pool.send_shell(&kernel_id, &msg).await?;
    } else {
        let client = pool.get_or_connect(&kernel_id, &manager, &app).await?;
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

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    crate::filesystem::rename_file(&old_path, &new_path)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Write failed: {}", e))
}

// ─── Terminal ────────────────────────────────────────────────────────

#[tauri::command]
pub fn spawn_terminal(
    app: tauri::AppHandle,
    manager: State<'_, crate::terminal::TerminalManager>,
    id: String,
    cwd: Option<String>,
) -> Result<(), String> {
    manager.spawn(&id, cwd, app)
}

#[tauri::command]
pub fn write_terminal(
    manager: State<'_, crate::terminal::TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&id, &data)
}

#[tauri::command]
pub fn kill_terminal(
    manager: State<'_, crate::terminal::TerminalManager>,
    id: String,
) -> Result<(), String> {
    manager.kill(&id)
}

// ─── AI ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ai_complete(system: String, prompt: String) -> Result<String, String> {
    crate::ai::complete(&system, &prompt).await
}

// ─── Settings ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings() -> crate::settings::Settings {
    crate::settings::read_settings()
}

#[tauri::command]
pub fn save_settings(settings: crate::settings::Settings) -> Result<(), String> {
    crate::settings::write_settings(&settings)
}

// ─── Code Intelligence ───────────────────────────────────────────────

#[tauri::command]
pub async fn complete_code(
    manager: State<'_, KernelManager>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
    code: String,
    cursor_pos: usize,
) -> Result<serde_json::Value, String> {
    // Remote kernels: completion not supported via WebSocket (no reply channel)
    if ws_pool.is_connected(&kernel_id).await {
        return Err("Completion not available for remote kernels".to_string());
    }

    let session = manager.get_session_id(&kernel_id).await?;
    let conn = manager.get_connection_info(&kernel_id).await?;

    let mut client = ShellClient::connect(conn).await?;

    let msg = JupyterMessage::new(
        "complete_request",
        &session,
        serde_json::json!({ "code": code, "cursor_pos": cursor_pos }),
    );

    client.send_shell(&msg).await?;

    match tokio::time::timeout(std::time::Duration::from_secs(5), client.shell.recv()).await {
        Ok(Ok(reply_msg)) => {
            let frames: Vec<Vec<u8>> = reply_msg.into_vec().iter().map(|f| f.to_vec()).collect();
            if let Ok(reply) = JupyterMessage::from_wire_frames(&frames, client.connection.key.as_bytes()) {
                Ok(reply.content)
            } else {
                Err("Failed to parse complete_reply".to_string())
            }
        }
        Ok(Err(e)) => Err(format!("Shell recv error: {}", e)),
        Err(_) => Err("Completion timeout".to_string()),
    }
}

#[tauri::command]
pub async fn inspect_code(
    manager: State<'_, KernelManager>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
    code: String,
    cursor_pos: usize,
) -> Result<serde_json::Value, String> {
    if ws_pool.is_connected(&kernel_id).await {
        return Err("Inspection not available for remote kernels".to_string());
    }

    let session = manager.get_session_id(&kernel_id).await?;
    let conn = manager.get_connection_info(&kernel_id).await?;

    let mut client = ShellClient::connect(conn).await?;

    let msg = JupyterMessage::new(
        "inspect_request",
        &session,
        serde_json::json!({ "code": code, "cursor_pos": cursor_pos, "detail_level": 0 }),
    );

    client.send_shell(&msg).await?;

    match tokio::time::timeout(std::time::Duration::from_secs(5), client.shell.recv()).await {
        Ok(Ok(reply_msg)) => {
            let frames: Vec<Vec<u8>> = reply_msg.into_vec().iter().map(|f| f.to_vec()).collect();
            if let Ok(reply) = JupyterMessage::from_wire_frames(&frames, client.connection.key.as_bytes()) {
                Ok(reply.content)
            } else {
                Err("Failed to parse inspect_reply".to_string())
            }
        }
        Ok(Err(e)) => Err(format!("Shell recv error: {}", e)),
        Err(_) => Err("Inspect timeout".to_string()),
    }
}

// ─── Memory ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_kernel_memory(
    manager: State<'_, KernelManager>,
    monitor: State<'_, std::sync::Mutex<MemoryMonitor>>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
) -> Result<MemoryInfo, String> {
    // Remote kernels don't have a local PID to monitor
    if ws_pool.is_connected(&kernel_id).await {
        return Err("Memory monitoring not available for remote kernels".to_string());
    }
    let pid = manager.get_kernel_pid(&kernel_id).await?;
    let mut mon = monitor.lock().map_err(|e| format!("Monitor lock: {}", e))?;
    mon.get_kernel_memory(pid)
        .ok_or_else(|| format!("Could not read memory for kernel {}", kernel_id))
}

/// The Python code that introspects kernel variables with deep sizing.
const INSPECT_VARS_CODE: &str = r#"
import sys as _sys, json as _json
_saturn_vars = {}
for _name, _obj in list(globals().items()):
    if _name.startswith('_') or callable(_obj) or _name.startswith('__'):
        continue
    if _name in ('In', 'Out', 'exit', 'quit', 'get_ipython'):
        continue
    _type = type(_obj).__name__
    try:
        if _type == 'DataFrame':
            _size = int(_obj.memory_usage(deep=True).sum())
            _shape = str(_obj.shape)
        elif _type == 'ndarray':
            _size = int(_obj.nbytes)
            _shape = str(_obj.shape)
        elif _type == 'Tensor':
            _size = int(_obj.element_size() * _obj.nelement())
            _shape = str(tuple(_obj.shape))
        elif _type == 'Series':
            _size = int(_obj.memory_usage(deep=True))
            _shape = str(_obj.shape)
        else:
            _size = _sys.getsizeof(_obj)
            _shape = ''
        _dtype = str(getattr(_obj, 'dtype', ''))
        _saturn_vars[_name] = {
            'type': _type, 'size': _size,
            'shape': _shape, 'dtype': _dtype,
            'id': id(_obj)
        }
    except Exception:
        _saturn_vars[_name] = {'type': _type, 'size': -1, 'shape': '', 'dtype': '', 'id': 0}
print('__SATURN_VARS__' + _json.dumps(_saturn_vars))
"#;

#[tauri::command]
pub async fn inspect_variables(
    app: tauri::AppHandle,
    manager: State<'_, KernelManager>,
    pool: State<'_, ZmqPool>,
    ws_pool: State<'_, crate::kernel::ws_client::WsPool>,
    kernel_id: String,
    msg_id: Option<String>,
) -> Result<String, String> {
    let session = if ws_pool.is_connected(&kernel_id).await {
        uuid::Uuid::new_v4().to_string()
    } else {
        manager.get_session_id(&kernel_id).await?
    };

    let mut msg = JupyterMessage::execute_request(&session, INSPECT_VARS_CODE, true);
    if let Some(id) = msg_id {
        msg.header.msg_id = id;
    }
    let msg_id = msg.header.msg_id.clone();

    if ws_pool.is_connected(&kernel_id).await {
        ws_pool.send_shell(&kernel_id, &msg).await?;
    } else {
        let client = pool.get_or_connect(&kernel_id, &manager, &app).await?;
        let mut zmq = client.lock().await;
        zmq.send_shell(&msg).await?;
    }

    Ok(msg_id)
}
