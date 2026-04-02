use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
pub struct MemoryInfo {
    /// Kernel process RSS in bytes.
    pub kernel_rss: u64,
    /// Total system memory in bytes.
    pub total_memory: u64,
    /// Available system memory in bytes.
    pub available_memory: u64,
}

pub struct MemoryMonitor {
    sys: System,
}

impl MemoryMonitor {
    pub fn new() -> Self {
        Self {
            sys: System::new(),
        }
    }

    /// Get memory info for a kernel process by PID.
    pub fn get_kernel_memory(&mut self, pid: u32) -> Option<MemoryInfo> {
        self.sys.refresh_memory();
        let target_pid = Pid::from_u32(pid);
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[target_pid]),
            true,
            ProcessRefreshKind::everything(),
        );

        let process_mem = self.sys.process(target_pid)?.memory();

        Some(MemoryInfo {
            kernel_rss: process_mem,
            total_memory: self.sys.total_memory(),
            available_memory: self.sys.available_memory(),
        })
    }
}
