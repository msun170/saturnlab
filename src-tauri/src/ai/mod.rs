use crate::settings::read_settings;
use serde_json::json;

/// Call the configured AI provider and return the response text.
pub async fn complete(system: &str, prompt: &str) -> Result<String, String> {
    let settings = read_settings();

    match settings.ai_provider.as_str() {
        "openai" | "custom" => {
            let base = if settings.ai_base_url.is_empty() {
                "https://api.openai.com".to_string()
            } else {
                settings.ai_base_url.trim_end_matches('/').to_string()
            };
            let model = if settings.ai_model.is_empty() {
                "gpt-4o-mini".to_string()
            } else {
                settings.ai_model.clone()
            };
            openai_compatible(&base, &settings.ai_api_key, &model, system, prompt).await
        }
        "anthropic" => {
            let model = if settings.ai_model.is_empty() {
                "claude-sonnet-4-20250514".to_string()
            } else {
                settings.ai_model.clone()
            };
            anthropic(&settings.ai_api_key, &model, system, prompt).await
        }
        "ollama" => {
            let base = if settings.ai_base_url.is_empty() {
                "http://localhost:11434".to_string()
            } else {
                settings.ai_base_url.trim_end_matches('/').to_string()
            };
            let model = if settings.ai_model.is_empty() {
                "codellama".to_string()
            } else {
                settings.ai_model.clone()
            };
            ollama(&base, &model, system, prompt).await
        }
        _ => Err("No AI provider configured. Go to Settings to set one up.".to_string()),
    }
}

async fn openai_compatible(
    base_url: &str,
    api_key: &str,
    model: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 2048,
            "temperature": 0.3
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("JSON parse: {}", e))?;
    let text = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(text)
}

async fn anthropic(
    api_key: &str,
    model: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 2048,
            "system": system,
            "messages": [
                {"role": "user", "content": prompt}
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("JSON parse: {}", e))?;
    let text = body["content"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(text)
}

async fn ollama(
    base_url: &str,
    model: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/chat", base_url))
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
            "stream": false
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {} (is Ollama running?)", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {}: {}", status, body));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("JSON parse: {}", e))?;
    let text = body["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(text)
}
