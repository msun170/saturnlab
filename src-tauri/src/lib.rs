mod commands;
mod filesystem;
mod kernel;
mod memory;
mod notebook;
mod session;
mod settings;

use commands::ZmqPool;
use kernel::manager::KernelManager;
use memory::monitor::MemoryMonitor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(KernelManager::new())
        .manage(ZmqPool::new())
        .manage(std::sync::Mutex::new(MemoryMonitor::new()))
        .invoke_handler(tauri::generate_handler![
            // Kernel management
            commands::list_kernelspecs,
            commands::start_kernel,
            commands::stop_kernel,
            commands::interrupt_kernel,
            commands::list_running_kernels,
            // Code execution
            commands::execute_code,
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
            // Memory
            commands::get_kernel_memory,
            commands::inspect_variables,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
