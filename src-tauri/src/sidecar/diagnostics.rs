//! RPC 호출 로그용 진단 유틸리티 — 응답/파라미터 요약, 민감 필드 레다크션

use super::protocol::JsonRpcResponse;

pub fn summarize_value(value: Option<&serde_json::Value>) -> String {
    fn shorten_path(value: &str) -> String {
        std::path::Path::new(value)
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or(value)
            .to_string()
    }

    fn preview(value: &serde_json::Value, depth: usize) -> serde_json::Value {
        use serde_json::{Map, Value};

        if depth >= 3 {
            return Value::String("<...>".into());
        }

        match value {
            Value::Object(map) => {
                let mut out = Map::new();
                for (idx, (key, item)) in map.iter().enumerate() {
                    if idx >= 10 {
                        out.insert(
                            "...".into(),
                            Value::String(format!("+{} more", map.len() - idx)),
                        );
                        break;
                    }
                    let lowered = key.to_ascii_lowercase();
                    let summarized = if lowered.contains("api_key")
                        || lowered.contains("token")
                        || lowered.contains("authorization")
                    {
                        Value::String("***redacted***".into())
                    } else if lowered == "files" {
                        match item {
                            Value::Array(items) => {
                                let mut arr = items
                                    .iter()
                                    .take(5)
                                    .map(|entry| match entry {
                                        Value::String(text) => Value::String(shorten_path(text)),
                                        other => preview(other, depth + 1),
                                    })
                                    .collect::<Vec<_>>();
                                if items.len() > 5 {
                                    arr.push(Value::String(format!("... +{}", items.len() - 5)));
                                }
                                Value::Array(arr)
                            }
                            other => preview(other, depth + 1),
                        }
                    } else if lowered.ends_with("_dir")
                        || lowered.ends_with("_path")
                        || lowered.ends_with("_file")
                        || lowered.ends_with("_folder")
                    {
                        match item {
                            Value::String(text) => Value::String(shorten_path(text)),
                            other => preview(other, depth + 1),
                        }
                    } else if lowered == "tags"
                        || lowered == "warnings"
                        || lowered == "steps"
                        || lowered == "thumbnails"
                    {
                        match item {
                            Value::Array(items) => Value::String(format!("{} items", items.len())),
                            other => preview(other, depth + 1),
                        }
                    } else {
                        preview(item, depth + 1)
                    };
                    out.insert(key.clone(), summarized);
                }
                Value::Object(out)
            }
            Value::Array(items) => {
                let mut arr = items
                    .iter()
                    .take(5)
                    .map(|item| preview(item, depth + 1))
                    .collect::<Vec<_>>();
                if items.len() > 5 {
                    arr.push(Value::String(format!("... +{}", items.len() - 5)));
                }
                Value::Array(arr)
            }
            Value::String(text) => {
                let compact = text.replace('\n', "\\n");
                if compact.len() > 200 {
                    let mut end = 197;
                    while end > 0 && !compact.is_char_boundary(end) {
                        end -= 1;
                    }
                    Value::String(format!("{}...", &compact[..end]))
                } else {
                    Value::String(compact)
                }
            }
            other => other.clone(),
        }
    }

    match value {
        Some(v) => {
            serde_json::to_string(&preview(v, 0)).unwrap_or_else(|_| "<unserializable>".into())
        }
        None => "null".into(),
    }
}

pub fn summarize_response(resp: &JsonRpcResponse) -> String {
    if let Some(result) = resp.result.as_ref() {
        return summarize_value(Some(result));
    }
    if let Some(err) = resp.error.as_ref() {
        return err.message.clone();
    }
    "null".into()
}
