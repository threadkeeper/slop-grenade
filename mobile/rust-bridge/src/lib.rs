//! Isolated in-memory mobile JSON API and safe JNI string adapter.
//!
//! Authentication, Gmail HTTP requests, scheduling, and LLM calls belong to Kotlin.
//! This crate never performs network IO or persists message content.

mod api;
pub mod jni_adapter;

pub use api::NativeCore;

use std::sync::{Mutex, OnceLock};

/// Handle one JSON request against the process-lifetime native session.
///
/// Responses always have `{status, body}`. Errors never echo input or parse details.
/// A poisoned session returns 503 rather than silently replacing the ledger.
pub fn request(input: &str) -> String {
    static CORE: OnceLock<Mutex<NativeCore>> = OnceLock::new();
    match CORE.get_or_init(|| Mutex::new(NativeCore::new())).lock() {
        Ok(mut core) => core.request(input),
        Err(_) => r#"{"status":503,"body":{"error":"Native session unavailable"}}"#.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_session_is_stable_across_requests() {
        let input = r#"{"method":"GET","path":"/internal/session"}"#;
        assert_eq!(request(input), request(input));
    }
}
