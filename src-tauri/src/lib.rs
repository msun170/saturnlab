mod commands;
mod filesystem;
mod kernel;
mod memory;
mod notebook;
mod session;
mod settings;

use kernel::manager::KernelManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(KernelManager::new())
        .invoke_handler(tauri::generate_handler![
            // Kernel management
            commands::list_kernelspecs,
            commands::start_kernel,
            commands::stop_kernel,
            commands::interrupt_kernel,
            commands::list_running_kernels,
            // Code execution
            commands::execute_code,
            // Notebook I/O
            commands::read_notebook,
            commands::write_notebook,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
