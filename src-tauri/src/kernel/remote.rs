//! REST API client for Jupyter Server / JupyterHub.
//!
//! Endpoints:
//!   GET  /api/kernelspecs        - list available kernels
//!   POST /api/kernels            - start a kernel
//!   DELETE /api/kernels/{id}     - stop a kernel
//!   POST /api/kernels/{id}/interrupt - interrupt

use crate::kernel::discovery::KernelSpec;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone)]
pub struct RemoteClient {
    pub base_url: String,
    pub token: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct KernelspecsResponse {
    default: Option<String>,
    kernelspecs: HashMap<String, KernelspecEntry>,
}

#[derive(Deserialize)]
struct KernelspecEntry {
    name: String,
    spec: KernelspecSpec,
}

#[derive(Deserialize)]
struct KernelspecSpec {
    display_name: String,
    language: String,
}

#[derive(Deserialize)]
pub struct RemoteKernelInfo {
    pub id: String,
    pub name: String,
    pub execution_state: String,
}

impl RemoteClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.base_url.is_empty() && !self.token.is_empty()
    }

    fn auth_header(&self) -> String {
        format!("token {}", self.token)
    }

    pub async fn list_kernelspecs(&self) -> Result<Vec<KernelSpec>, String> {
        let resp = self.client
            .get(format!("{}/api/kernelspecs", self.base_url))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| format!("Remote kernelspecs: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Remote server error: {}", resp.status()));
        }

        let body: KernelspecsResponse = resp.json().await
            .map_err(|e| format!("Parse kernelspecs: {}", e))?;

        let specs = body.kernelspecs.into_values().map(|entry| {
            KernelSpec {
                name: entry.name,
                display_name: entry.spec.display_name,
                language: entry.spec.language,
                argv: vec![],
                env: HashMap::new(),
                spec_dir: std::path::PathBuf::new(),
            }
        }).collect();

        Ok(specs)
    }

    pub async fn start_kernel(&self, spec_name: &str) -> Result<RemoteKernelInfo, String> {
        let resp = self.client
            .post(format!("{}/api/kernels", self.base_url))
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({ "name": spec_name }))
            .send()
            .await
            .map_err(|e| format!("Start remote kernel: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Start kernel error {}: {}", status, body));
        }

        resp.json().await.map_err(|e| format!("Parse kernel info: {}", e))
    }

    pub async fn stop_kernel(&self, kernel_id: &str) -> Result<(), String> {
        let resp = self.client
            .delete(format!("{}/api/kernels/{}", self.base_url, kernel_id))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| format!("Stop remote kernel: {}", e))?;

        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NO_CONTENT {
            return Err(format!("Stop kernel error: {}", resp.status()));
        }

        Ok(())
    }

    pub async fn interrupt_kernel(&self, kernel_id: &str) -> Result<(), String> {
        let resp = self.client
            .post(format!("{}/api/kernels/{}/interrupt", self.base_url, kernel_id))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| format!("Interrupt remote kernel: {}", e))?;

        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NO_CONTENT {
            return Err(format!("Interrupt kernel error: {}", resp.status()));
        }

        Ok(())
    }

    /// Build the WebSocket URL for kernel channels.
    pub fn ws_url(&self, kernel_id: &str) -> String {
        let ws_base = self.base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        format!("{}/api/kernels/{}/channels?token={}", ws_base, kernel_id, self.token)
    }
}
