mod ai;
mod commands;
mod filesystem;
mod kernel;
mod memory;
mod notebook;
mod session;
mod settings;
pub mod terminal;

use commands::ZmqPool;
use kernel::manager::KernelManager;
use kernel::ws_client::WsPool;
use memory::monitor::MemoryMonitor;
use terminal::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(KernelManager::new())
        .manage(ZmqPool::new())
        .manage(std::sync::Mutex::new(MemoryMonitor::new()))
        .manage(WsPool::new())
        .manage(TerminalManager::new())
        .invoke_handler(tauri::generate_handler![
            // Kernel management
            commands::list_kernelspecs,
            commands::start_kernel,
            commands::stop_kernel,
            commands::interrupt_kernel,
            commands::list_running_kernels,
            // Code execution
            commands::execute_code,
            // Widget comm
            commands::send_comm_msg,
            // Code intelligence
            commands::complete_code,
            commands::inspect_code,
            // Notebook I/O
            commands::read_notebook,
            commands::write_notebook,
            // Filesystem
            commands::list_directory,
            commands::get_cwd,
            commands::rename_file,
            commands::read_text_file,
            commands::write_text_file,
            // Settings
            commands::get_settings,
            commands::save_settings,
            // Memory
            commands::get_kernel_memory,
            commands::inspect_variables,
            // AI
            commands::ai_complete,
            // Terminal
            commands::spawn_terminal,
            commands::write_terminal,
            commands::kill_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
