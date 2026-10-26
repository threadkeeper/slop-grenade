//! Safe Java string conversion for the Kotlin static native request boundary.
//!
//! Only the exported symbol's `no_mangle` attribute permits unsafe code; all JNI
//! operations use checked wrappers, and Rust panics never cross the JNI boundary.

use std::panic::{catch_unwind, AssertUnwindSafe};

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

const JNI_ERROR: &str = "Native request failed";
const PANIC_ERROR: &str = "Native request panicked";

/// Kotlin's `com.threadkeeper.slopgrenade.core.NativeCore.request` entrypoint.
///
/// A null return always accompanies a pending Java exception. If the VM cannot
/// establish an exception, terminate through JNI rather than returning invalidly.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "system" fn Java_com_threadkeeper_slopgrenade_core_NativeCore_request<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    input: JString<'local>,
) -> jstring {
    match boundary(|| request(&mut env, input).map(JString::into_raw)) {
        Ok(response) => response,
        Err(message) => {
            let thrown = boundary(|| {
                if !env.exception_check()? {
                    env.throw_new("java/lang/IllegalStateException", message)?;
                }
                env.exception_check()
            });
            if !matches!(thrown, Ok(true)) {
                env.fatal_error(JNI_ERROR);
            }
            std::ptr::null_mut()
        }
    }
}

fn boundary<T>(operation: impl FnOnce() -> jni::errors::Result<T>) -> Result<T, &'static str> {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(result) => result.map_err(|_| JNI_ERROR),
        Err(payload) => {
            // A user-defined panic payload may itself panic when dropped.
            std::mem::forget(payload);
            Err(PANIC_ERROR)
        }
    }
}

/// Convert a Java request string and create a Java JSON response string.
///
/// Java allocation/conversion failures propagate as JNI errors without logging
/// the input. The Java caller must only supply references from this JNI frame.
pub fn request<'local>(
    env: &mut JNIEnv<'local>,
    input: JString<'local>,
) -> jni::errors::Result<JString<'local>> {
    let input: String = env.get_string(&input)?.into();
    let response = crate::request(&input);
    env.new_string(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_accepts_a_frame_local_java_string() {
        // Type-check the adapter on the host without manufacturing JVM pointers.
        let _adapter = request;
    }

    #[test]
    fn boundary_preserves_success_and_sanitizes_jni_errors() {
        assert_eq!(boundary(|| Ok(42)), Ok(42));
        assert_eq!(
            boundary::<()>(|| Err(jni::errors::Error::NullPtr("private input"))),
            Err(JNI_ERROR)
        );
    }

    #[test]
    fn boundary_contains_panics_and_does_not_drop_their_payloads() {
        struct PanickingDrop;
        impl Drop for PanickingDrop {
            fn drop(&mut self) {
                panic!("payload must not be dropped");
            }
        }
        assert_eq!(
            boundary::<()>(|| std::panic::panic_any(PanickingDrop)),
            Err(PANIC_ERROR)
        );
    }

    #[test]
    fn malformed_requests_are_sanitized_without_unwinding() {
        let nested = format!("{}\"private\"{}", "[".repeat(256), "]".repeat(256));
        for input in [
            "",
            "private input",
            "\0",
            r#"{"method":42,"path":"private"}"#,
            r#"{"method":"POST","path":"/api/v1/analyze","body":{"body":null}}"#,
            r#"{"method":"GET","path":"/api/v1/events?after=18446744073709551616"}"#,
            &nested,
        ] {
            let response = boundary(|| Ok(crate::request(input))).unwrap();
            let response: serde_json::Value = serde_json::from_str(&response).unwrap();
            assert_eq!(response["status"], 400);
            assert!(!response.to_string().contains("private"));
        }
    }
}
