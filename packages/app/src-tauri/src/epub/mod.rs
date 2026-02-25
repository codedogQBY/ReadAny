/// EPUB parsing module

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct EpubChapter {
    pub index: usize,
    pub title: String,
    pub content: String, // HTML content
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EpubMetadata {
    pub title: String,
    pub author: String,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub subjects: Vec<String>,
}

/// Parse an EPUB file and extract metadata
pub fn parse_metadata(_file_path: &str) -> anyhow::Result<EpubMetadata> {
    // TODO: Use epub crate to parse
    Ok(EpubMetadata {
        title: String::new(),
        author: String::new(),
        publisher: None,
        language: None,
        description: None,
        subjects: vec![],
    })
}

/// Extract all chapters from an EPUB file
pub fn extract_chapters(_file_path: &str) -> anyhow::Result<Vec<EpubChapter>> {
    // TODO: Use epub crate to extract chapters
    Ok(vec![])
}
