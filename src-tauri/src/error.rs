use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Sidecar error: {0}")]
    Sidecar(String),
    #[error("JSON-RPC error: {0}")]
    JsonRpc(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
}

// Tauri commands require IntoResponse, which needs Serialize on the error type
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
