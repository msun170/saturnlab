//! WebSocket transport for remote Jupyter kernels.
//!
//! The Jupyter Server WebSocket at /api/kernels/{id}/channels multiplexes
//! all channels (shell, iopub, stdin, control) over a single connection.
//! Messages are JSON with the same format as the ZMQ wire protocol
//! (header, parent_header, metadata, content, channel).

use crate::kernel::message::{Header, JupyterMessage};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

/// JSON message format on the Jupyter WebSocket.
#[derive(Debug, Serialize, Deserialize)]
struct WsJupyterMessage {
    header: Header,
    parent_header: serde_json::Value,
    metadata: serde_json::Value,
    content: serde_json::Value,
    channel: String,
    #[serde(default)]
    buffers: Vec<String>, // base64-encoded buffers
}

#[derive(Serialize, Clone)]
struct KernelOutput {
    kernel_id: String,
    msg_type: String,
    content: serde_json::Value,
    parent_msg_id: String,
}

type WsSender = Arc<Mutex<futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tokio_tungstenite::tungstenite::Message,
>>>;

pub struct WsPool {
    connections: Arc<tokio::sync::RwLock<HashMap<String, WsSender>>>,
}

impl WsPool {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
        }
    }

    /// Connect to a remote kernel's WebSocket and start the listener.
    pub async fn connect(
        &self,
        kernel_id: &str,
        ws_url: &str,
        app: tauri::AppHandle,
    ) -> Result<WsSender, String> {
        // Check if already connected
        {
            let conns = self.connections.read().await;
            if let Some(sender) = conns.get(kernel_id) {
                return Ok(sender.clone());
            }
        }

        let (ws_stream, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .map_err(|e| format!("WebSocket connect: {}", e))?;

        let (write, read) = ws_stream.split();
        let sender = Arc::new(Mutex::new(write));

        // Store sender
        {
            let mut conns = self.connections.write().await;
            conns.insert(kernel_id.to_string(), sender.clone());
        }

        // Spawn listener task
        let kid = kernel_id.to_string();
        let conns = self.connections.clone();
        tokio::spawn(async move {
            let mut read = read;
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                        if let Ok(ws_msg) = serde_json::from_str::<WsJupyterMessage>(&text) {
                            // Only forward iopub messages (same as ZMQ iopub listener)
                            if ws_msg.channel == "iopub" {
                                let parent_id = ws_msg.parent_header
                                    .get("msg_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();

                                let _ = app.emit("kernel-output", &KernelOutput {
                                    kernel_id: kid.clone(),
                                    msg_type: ws_msg.header.msg_type.clone(),
                                    content: ws_msg.content.clone(),
                                    parent_msg_id: parent_id,
                                });
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("WebSocket error for kernel {}: {}", kid, e);
                        break;
                    }
                    _ => {} // ignore binary/ping/pong/close
                }
            }

            // Clean up on disconnect
            let mut conns = conns.write().await;
            conns.remove(&kid);
        });

        Ok(sender)
    }

    /// Send a message on the shell channel via WebSocket.
    pub async fn send_shell(
        &self,
        kernel_id: &str,
        msg: &JupyterMessage,
    ) -> Result<(), String> {
        let conns = self.connections.read().await;
        let sender = conns.get(kernel_id)
            .ok_or_else(|| format!("No WebSocket connection for kernel {}", kernel_id))?;

        let ws_msg = WsJupyterMessage {
            header: msg.header.clone(),
            parent_header: msg.parent_header.clone(),
            metadata: msg.metadata.clone(),
            content: msg.content.clone(),
            channel: "shell".to_string(),
            buffers: vec![],
        };

        let json = serde_json::to_string(&ws_msg)
            .map_err(|e| format!("Serialize: {}", e))?;

        let mut sender = sender.lock().await;
        sender.send(tokio_tungstenite::tungstenite::Message::Text(json))
            .await
            .map_err(|e| format!("WebSocket send: {}", e))
    }

    /// Disconnect from a kernel's WebSocket.
    pub async fn disconnect(&self, kernel_id: &str) {
        let mut conns = self.connections.write().await;
        if let Some(sender) = conns.remove(kernel_id) {
            let mut sender = sender.lock().await;
            let _ = sender.close().await;
        }
    }

    pub async fn is_connected(&self, kernel_id: &str) -> bool {
        let conns = self.connections.read().await;
        conns.contains_key(kernel_id)
    }
}
