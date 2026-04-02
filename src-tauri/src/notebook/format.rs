use serde::{Deserialize, Serialize};

/// A Jupyter notebook (nbformat v4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notebook {
    pub nbformat: u32,
    pub nbformat_minor: u32,
    pub metadata: NotebookMetadata,
    pub cells: Vec<Cell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookMetadata {
    #[serde(default)]
    pub kernelspec: Option<KernelSpecMeta>,
    #[serde(default)]
    pub language_info: Option<LanguageInfo>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelSpecMeta {
    pub name: String,
    pub display_name: String,
    #[serde(default)]
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageInfo {
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// A single notebook cell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cell {
    pub cell_type: CellType,
    pub source: CellSource,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outputs: Option<Vec<Output>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_count: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CellType {
    Code,
    Markdown,
    Raw,
}

/// Cell source can be a single string or an array of strings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CellSource {
    String(String),
    Lines(Vec<String>),
}

impl CellSource {
    pub fn as_string(&self) -> String {
        match self {
            CellSource::String(s) => s.clone(),
            CellSource::Lines(lines) => lines.join(""),
        }
    }
}

/// A cell output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Output {
    pub output_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<CellSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evalue: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceback: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_count: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Notebook {
    /// Create a new empty notebook.
    pub fn new(kernel_name: &str, display_name: &str, language: &str) -> Self {
        Self {
            nbformat: 4,
            nbformat_minor: 5,
            metadata: NotebookMetadata {
                kernelspec: Some(KernelSpecMeta {
                    name: kernel_name.to_string(),
                    display_name: display_name.to_string(),
                    language: language.to_string(),
                }),
                language_info: Some(LanguageInfo {
                    name: language.to_string(),
                    version: String::new(),
                    extra: serde_json::Map::new(),
                }),
                extra: serde_json::Map::new(),
            },
            cells: vec![Cell {
                cell_type: CellType::Code,
                source: CellSource::String(String::new()),
                metadata: serde_json::json!({}),
                outputs: Some(vec![]),
                execution_count: Some(serde_json::Value::Null),
                id: Some(uuid::Uuid::new_v4().to_string()),
            }],
        }
    }
}
