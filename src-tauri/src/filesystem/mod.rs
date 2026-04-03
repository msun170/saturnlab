use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

/// List directory contents one level deep.
/// Directories first, then files, both alphabetical.
pub fn list_directory(dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(dir_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    let entries = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common non-useful directories
        if name.starts_with('.') || name == "node_modules" || name == "__pycache__" || name == "target" {
            continue;
        }

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let file_entry = FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        };

        if metadata.is_dir() {
            dirs.push(file_entry);
        } else {
            files.push(file_entry);
        }
    }

    // Sort alphabetically
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Directories first, then files
    dirs.append(&mut files);
    Ok(dirs)
}

/// Get the current working directory.
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get cwd: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_list_directory() {
        let tmp = std::env::temp_dir().join("saturn_test_dir");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        fs::create_dir(tmp.join("subdir")).unwrap();
        fs::write(tmp.join("file.txt"), "hello").unwrap();
        fs::write(tmp.join("notebook.ipynb"), "{}").unwrap();

        let entries = list_directory(tmp.to_str().unwrap()).unwrap();

        // Directories first
        assert_eq!(entries[0].name, "subdir");
        assert!(entries[0].is_dir);

        // Then files alphabetically
        assert_eq!(entries[1].name, "file.txt");
        assert_eq!(entries[2].name, "notebook.ipynb");
        assert!(!entries[1].is_dir);

        let _ = fs::remove_dir_all(&tmp);
    }
}
