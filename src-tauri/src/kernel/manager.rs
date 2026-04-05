use crate::kernel::discovery::{discover_kernelspecs, KernelSpec};
use crate::kernel::message::JupyterMessage;
use crate::kernel::zmq_client::{ConnectionInfo, ShellClient};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Represents a running kernel instance.
pub struct KernelInstance {
    pub id: String,
    pub spec: KernelSpec,
    pub connection: ConnectionInfo,
    pub process: Child,
    pub session_id: String,
    pub connection_file: PathBuf,
}

/// Serializable kernel info for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct KernelInfo {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub language: String,
    pub status: String,
}

/// Manages kernel lifecycle.
pub struct KernelManager {
    pub kernels: Arc<RwLock<HashMap<String, KernelInstance>>>,
}

impl KernelManager {
    pub fn new() -> Self {
        Self {
            kernels: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// List all available kernelspecs on the system.
    pub fn list_kernelspecs(&self) -> Vec<KernelSpec> {
        discover_kernelspecs()
    }

    /// Start a new kernel from a kernelspec name.
    pub async fn start_kernel(&self, spec_name: &str) -> Result<String, String> {
        let specs = discover_kernelspecs();
        let spec = specs
            .into_iter()
            .find(|s| s.name == spec_name)
            .ok_or_else(|| format!("Kernelspec '{}' not found", spec_name))?;

        let kernel_id = uuid::Uuid::new_v4().to_string();
        let session_id = uuid::Uuid::new_v4().to_string();

        // Generate connection info with random ports
        let conn_info = ConnectionInfo::generate(&spec.name);

        // Write connection file to temp directory
        let conn_file = std::env::temp_dir().join(format!("saturn-kernel-{}.json", kernel_id));
        conn_info.write_to_file(&conn_file)?;

        // Build the kernel launch command
        // Replace {connection_file} in argv
        let args: Vec<String> = spec
            .argv
            .iter()
            .map(|a| a.replace("{connection_file}", &conn_file.to_string_lossy()))
            .collect();

        if args.is_empty() {
            return Err("Kernelspec has empty argv".to_string());
        }

        // Spawn the kernel process
        let mut cmd = std::process::Command::new(&args[0]);
        if args.len() > 1 {
            cmd.args(&args[1..]);
        }

        // Set environment variables from kernelspec
        for (key, val) in &spec.env {
            cmd.env(key, val);
        }

        // Detach stdout/stderr to avoid blocking
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // On Windows, prevent a console window from flashing open
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn kernel: {}", e))?;

        let instance = KernelInstance {
            id: kernel_id.clone(),
            spec,
            connection: conn_info,
            process: child,
            session_id,
            connection_file: conn_file,
        };

        self.kernels.write().await.insert(kernel_id.clone(), instance);

        Ok(kernel_id)
    }

    /// Stop a running kernel.
    pub async fn stop_kernel(&self, kernel_id: &str) -> Result<(), String> {
        let mut kernels = self.kernels.write().await;
        let instance = kernels
            .remove(kernel_id)
            .ok_or_else(|| format!("Kernel '{}' not found", kernel_id))?;

        // Clean up connection file
        let _ = std::fs::remove_file(&instance.connection_file);

        // Kill the process
        let mut process = instance.process;
        let _ = process.kill();

        Ok(())
    }

    /// Get connection info for a kernel (needed to connect ZMQ).
    pub async fn get_connection_info(&self, kernel_id: &str) -> Result<ConnectionInfo, String> {
        let kernels = self.kernels.read().await;
        let instance = kernels
            .get(kernel_id)
            .ok_or_else(|| format!("Kernel '{}' not found", kernel_id))?;
        Ok(instance.connection.clone())
    }

    /// Get the session ID for a kernel.
    pub async fn get_session_id(&self, kernel_id: &str) -> Result<String, String> {
        let kernels = self.kernels.read().await;
        let instance = kernels
            .get(kernel_id)
            .ok_or_else(|| format!("Kernel '{}' not found", kernel_id))?;
        Ok(instance.session_id.clone())
    }

    /// List all running kernels.
    pub async fn list_kernels(&self) -> Vec<KernelInfo> {
        let kernels = self.kernels.read().await;
        kernels
            .values()
            .map(|k| KernelInfo {
                id: k.id.clone(),
                name: k.spec.name.clone(),
                display_name: k.spec.display_name.clone(),
                language: k.spec.language.clone(),
                status: "alive".to_string(),
            })
            .collect()
    }

    /// Get the OS process ID for a running kernel.
    pub async fn get_kernel_pid(&self, kernel_id: &str) -> Result<u32, String> {
        let kernels = self.kernels.read().await;
        let instance = kernels
            .get(kernel_id)
            .ok_or_else(|| format!("Kernel '{}' not found", kernel_id))?;
        Ok(instance.process.id())
    }

    /// Interrupt a running kernel (send SIGINT on Unix, ControlC event on Windows).
    pub async fn interrupt_kernel(&self, kernel_id: &str) -> Result<(), String> {
        let kernels = self.kernels.read().await;
        let instance = kernels
            .get(kernel_id)
            .ok_or_else(|| format!("Kernel '{}' not found", kernel_id))?;

        // Try sending interrupt via control channel
        // This is the cross-platform approach
        let conn = instance.connection.clone();
        let session = instance.session_id.clone();
        drop(kernels); // Release the lock

        let mut client = ShellClient::connect(conn).await?;
        let msg = JupyterMessage::new("interrupt_request", &session, serde_json::json!({}));
        client.send_control(&msg).await?;

        Ok(())
    }
}
