use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// A kernel specification as defined by Jupyter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelSpec {
    pub name: String,
    pub display_name: String,
    pub language: String,
    pub argv: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Path to the kernelspec directory on disk.
    #[serde(skip)]
    #[allow(dead_code)]
    pub spec_dir: PathBuf,
}

/// Raw kernel.json as found on disk.
#[derive(Debug, Deserialize)]
struct KernelJsonRaw {
    display_name: String,
    #[serde(default)]
    language: String,
    argv: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
}

/// Discover all installed Jupyter kernelspecs.
pub fn discover_kernelspecs() -> Vec<KernelSpec> {
    let mut specs = Vec::new();
    let search_dirs = get_kernelspec_dirs();

    for dir in search_dirs {
        let kernels_dir = dir.join("kernels");
        if !kernels_dir.is_dir() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(&kernels_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let kernel_json = path.join("kernel.json");
                if !kernel_json.exists() {
                    continue;
                }

                match std::fs::read_to_string(&kernel_json) {
                    Ok(contents) => match serde_json::from_str::<KernelJsonRaw>(&contents) {
                        Ok(raw) => {
                            let name = path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            specs.push(KernelSpec {
                                name,
                                display_name: raw.display_name,
                                language: raw.language,
                                argv: raw.argv,
                                env: raw.env,
                                spec_dir: path,
                            });
                        }
                        Err(e) => {
                            eprintln!("Failed to parse {}: {}", kernel_json.display(), e);
                        }
                    },
                    Err(e) => {
                        eprintln!("Failed to read {}: {}", kernel_json.display(), e);
                    }
                }
            }
        }
    }

    specs
}

/// Get the list of directories to search for kernelspecs.
/// Uses Python's jupyter_core.paths for the most reliable results,
/// with fallback to hardcoded well-known locations.
fn get_kernelspec_dirs() -> Vec<PathBuf> {
    // Try the authoritative source: ask Python for jupyter data paths
    if let Some(dirs) = get_jupyter_paths_from_python() {
        if !dirs.is_empty() {
            return dirs;
        }
    }

    // Fallback: hardcoded well-known locations
    let mut dirs = Vec::new();

    if let Some(data_dir) = get_jupyter_data_dir() {
        dirs.push(data_dir);
    }

    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            // Standard Jupyter data dir
            dirs.push(PathBuf::from(&appdata).join("jupyter"));
            // Python-installed packages put kernelspecs here
            dirs.push(PathBuf::from(&appdata).join("Python").join("share").join("jupyter"));
        }
        if let Ok(programdata) = std::env::var("PROGRAMDATA") {
            dirs.push(PathBuf::from(programdata).join("jupyter"));
        }
    }

    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/usr/local/share/jupyter"));
        dirs.push(PathBuf::from("/usr/share/jupyter"));
    }

    if let Some(prefix_dir) = get_sys_prefix_jupyter_dir() {
        dirs.push(prefix_dir);
    }

    dirs
}

/// Ask Python for the Jupyter data paths (most reliable on all platforms).
fn get_jupyter_paths_from_python() -> Option<Vec<PathBuf>> {
    let output = std::process::Command::new("python")
        .args(["-c", "import jupyter_core.paths, json; print(json.dumps(jupyter_core.paths.jupyter_path()))"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let paths: Vec<String> = serde_json::from_str(stdout.trim()).ok()?;
    Some(paths.into_iter().map(PathBuf::from).collect())
}

/// Get the user's Jupyter data directory.
fn get_jupyter_data_dir() -> Option<PathBuf> {
    // Check JUPYTER_DATA_DIR env var first
    if let Ok(dir) = std::env::var("JUPYTER_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }

    #[cfg(windows)]
    {
        std::env::var("APPDATA")
            .ok()
            .map(|d| PathBuf::from(d).join("jupyter"))
    }

    #[cfg(not(windows))]
    {
        dirs::data_local_dir().map(|d| d.join("jupyter"))
    }
}

/// Get the Jupyter data dir inside the current Python environment.
fn get_sys_prefix_jupyter_dir() -> Option<PathBuf> {
    let output = std::process::Command::new("python")
        .args(["-c", "import sys; print(sys.prefix)"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prefix.is_empty() {
        return None;
    }

    let path = PathBuf::from(&prefix).join("share").join("jupyter");
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}
