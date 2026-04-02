use crate::notebook::format::Notebook;
use std::path::Path;

/// Read a notebook from a .ipynb file.
pub fn read_notebook(path: &Path) -> Result<Notebook, String> {
    let contents =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// Write a notebook to a .ipynb file.
pub fn write_notebook(path: &Path, notebook: &Notebook) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(notebook)
        .map_err(|e| format!("Failed to serialize notebook: {}", e))?;
    std::fs::write(path, contents)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}
