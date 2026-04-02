use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

/// A Jupyter wire protocol message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterMessage {
    pub header: Header,
    pub parent_header: serde_json::Value,
    pub metadata: serde_json::Value,
    pub content: serde_json::Value,
    #[serde(default)]
    pub buffers: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Header {
    pub msg_id: String,
    pub session: String,
    pub username: String,
    pub date: String,
    pub msg_type: String,
    pub version: String,
}

impl JupyterMessage {
    /// Create a new message with the given type and content.
    pub fn new(msg_type: &str, session: &str, content: serde_json::Value) -> Self {
        Self {
            header: Header {
                msg_id: Uuid::new_v4().to_string(),
                session: session.to_string(),
                username: "saturn".to_string(),
                date: chrono_now(),
                msg_type: msg_type.to_string(),
                version: "5.3".to_string(),
            },
            parent_header: serde_json::Value::Object(serde_json::Map::new()),
            metadata: serde_json::Value::Object(serde_json::Map::new()),
            content,
            buffers: vec![],
        }
    }

    /// Create an execute_request message.
    pub fn execute_request(session: &str, code: &str, silent: bool) -> Self {
        Self::new(
            "execute_request",
            session,
            serde_json::json!({
                "code": code,
                "silent": silent,
                "store_history": !silent,
                "user_expressions": {},
                "allow_stdin": false,
                "stop_on_error": true,
            }),
        )
    }

    /// Serialize this message into ZMQ multipart frames.
    /// Wire format: [identity, delimiter, HMAC, header, parent, metadata, content, buffers...]
    pub fn to_wire_frames(&self, key: &[u8]) -> Vec<Vec<u8>> {
        let header_bytes = serde_json::to_vec(&self.header).unwrap_or_default();
        let parent_bytes = serde_json::to_vec(&self.parent_header).unwrap_or_default();
        let metadata_bytes = serde_json::to_vec(&self.metadata).unwrap_or_default();
        let content_bytes = serde_json::to_vec(&self.content).unwrap_or_default();

        let signature = compute_signature(
            key,
            &header_bytes,
            &parent_bytes,
            &metadata_bytes,
            &content_bytes,
        );

        let mut frames = vec![
            b"<IDS|MSG>".to_vec(),
            signature.into_bytes(),
            header_bytes,
            parent_bytes,
            metadata_bytes,
            content_bytes,
        ];

        for buf in &self.buffers {
            frames.push(buf.clone());
        }

        frames
    }

    /// Parse a JupyterMessage from ZMQ multipart frames.
    pub fn from_wire_frames(frames: &[Vec<u8>], _key: &[u8]) -> Result<Self, String> {
        // Find the delimiter
        let delim_pos = frames
            .iter()
            .position(|f| f.as_slice() == b"<IDS|MSG>")
            .ok_or("Missing <IDS|MSG> delimiter")?;

        // Frames after delimiter: signature, header, parent, metadata, content, [buffers...]
        let after_delim = &frames[delim_pos + 1..];
        if after_delim.len() < 5 {
            return Err(format!(
                "Not enough frames after delimiter: got {}",
                after_delim.len()
            ));
        }

        // after_delim[0] = signature (skip verification for now)
        let header: Header =
            serde_json::from_slice(&after_delim[1]).map_err(|e| format!("Bad header: {}", e))?;
        let parent_header: serde_json::Value =
            serde_json::from_slice(&after_delim[2]).map_err(|e| format!("Bad parent: {}", e))?;
        let metadata: serde_json::Value =
            serde_json::from_slice(&after_delim[3]).map_err(|e| format!("Bad metadata: {}", e))?;
        let content: serde_json::Value =
            serde_json::from_slice(&after_delim[4]).map_err(|e| format!("Bad content: {}", e))?;

        let buffers: Vec<Vec<u8>> = if after_delim.len() > 5 {
            after_delim[5..].to_vec()
        } else {
            vec![]
        };

        Ok(Self {
            header,
            parent_header,
            metadata,
            content,
            buffers,
        })
    }
}

/// HMAC-SHA256 signature of the message frames.
fn compute_signature(
    key: &[u8],
    header: &[u8],
    parent: &[u8],
    metadata: &[u8],
    content: &[u8],
) -> String {
    if key.is_empty() {
        return String::new();
    }
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(header);
    mac.update(parent);
    mac.update(metadata);
    mac.update(content);
    hex::encode(mac.finalize().into_bytes())
}

/// ISO 8601 timestamp (simplified — no chrono dependency).
fn chrono_now() -> String {
    // Use a simple approach without pulling in chrono
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("1970-01-01T00:00:00.000Z+{}", duration.as_secs())
}
