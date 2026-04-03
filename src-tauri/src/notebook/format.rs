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
    #[allow(dead_code)]
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
    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cell_source_string() {
        let source = CellSource::String("print('hello')".to_string());
        assert_eq!(source.as_string(), "print('hello')");
    }

    #[test]
    fn test_cell_source_lines() {
        let source = CellSource::Lines(vec![
            "import pandas as pd\n".to_string(),
            "df = pd.read_csv('test.csv')".to_string(),
        ]);
        assert_eq!(
            source.as_string(),
            "import pandas as pd\ndf = pd.read_csv('test.csv')"
        );
    }

    #[test]
    fn test_parse_notebook_json() {
        let json = r#"{
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {
                "kernelspec": {
                    "name": "python3",
                    "display_name": "Python 3",
                    "language": "python"
                }
            },
            "cells": [
                {
                    "cell_type": "code",
                    "source": ["print('hello')\n"],
                    "metadata": {},
                    "outputs": [
                        {
                            "output_type": "stream",
                            "name": "stdout",
                            "text": ["hello\n"]
                        }
                    ],
                    "execution_count": 1
                },
                {
                    "cell_type": "markdown",
                    "source": "Title heading",
                    "metadata": {}
                }
            ]
        }"#;

        let nb: Notebook = serde_json::from_str(json).unwrap();
        assert_eq!(nb.nbformat, 4);
        assert_eq!(nb.cells.len(), 2);
        assert_eq!(nb.cells[0].cell_type, CellType::Code);
        assert_eq!(nb.cells[1].cell_type, CellType::Markdown);
        assert_eq!(nb.cells[0].source.as_string(), "print('hello')\n");

        let outputs = nb.cells[0].outputs.as_ref().unwrap();
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].output_type, "stream");
    }

    #[test]
    fn test_roundtrip_notebook() {
        let nb = Notebook::new("python3", "Python 3", "python");
        let json = serde_json::to_string(&nb).unwrap();
        let parsed: Notebook = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.nbformat, 4);
        assert_eq!(parsed.cells.len(), 1);
        assert_eq!(parsed.cells[0].cell_type, CellType::Code);
    }
}
