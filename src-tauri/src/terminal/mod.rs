use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub struct TerminalManager {
    terminals: Arc<Mutex<HashMap<String, TerminalInstance>>>,
}

struct TerminalInstance {
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send>,
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(&self, id: &str, cwd: Option<String>, app_handle: tauri::AppHandle) -> Result<(), String> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        #[cfg(windows)]
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        #[cfg(not(windows))]
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        let working_dir = cwd
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_dir())
            .or_else(|| dirs::home_dir())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));
        cmd.cwd(working_dir);

        let child = pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let writer = pair.master.take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let term_id = id.to_string();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit("terminal-output", serde_json::json!({
                            "id": term_id,
                            "data": data,
                        }));
                    }
                    Err(_) => break,
                }
            }
        });

        self.terminals.lock().map_err(|e| format!("Lock: {}", e))?
            .insert(id.to_string(), TerminalInstance { writer, _child: child, _master: pair.master });
        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut terms = self.terminals.lock().map_err(|e| format!("Lock: {}", e))?;
        let term = terms.get_mut(id).ok_or("Terminal not found")?;
        term.writer.write_all(data.as_bytes()).map_err(|e| format!("Write: {}", e))?;
        term.writer.flush().map_err(|e| format!("Flush: {}", e))
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        self.terminals.lock().map_err(|e| format!("Lock: {}", e))?.remove(id);
        Ok(())
    }
}
