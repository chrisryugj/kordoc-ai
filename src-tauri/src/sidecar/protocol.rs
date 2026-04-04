use serde::{Deserialize, Serialize};

/// JSON-RPC 2.0 Request (sent to Node.js sidecar)
#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl JsonRpcRequest {
    pub fn new(id: u64, method: &str, params: Option<serde_json::Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        }
    }
}

/// JSON-RPC 2.0 Response (received from Node.js sidecar)
#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    #[allow(dead_code)]
    pub jsonrpc: String,
    pub id: Option<u64>,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
    pub method: Option<String>,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

impl JsonRpcResponse {
    /// Check if this is a notification (no id, has method)
    pub fn is_notification(&self) -> bool {
        self.id.is_none() && self.method.is_some()
    }

    /// Extract result or convert error to AppError.
    pub fn extract_result(self) -> crate::error::AppResult<serde_json::Value> {
        if let Some(error) = self.error {
            Err(crate::error::AppError::JsonRpc(error.message))
        } else {
            Ok(self.result.unwrap_or(serde_json::Value::Null))
        }
    }
}
