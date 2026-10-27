//! Slop Grenade library root.
//!
//! Exposes the modular components of the Slop Grenade daemon so both the binary
//! entrypoint (`main.rs`) and the integration test suite (`rust/tests/`) share
//! the exact same verified types.

pub mod auth;
pub mod config;
pub mod event_bus;
pub mod gmail_account;
pub mod gmail_auth;
pub mod gmail_client;
pub mod gmail_error;
mod gmail_http;
mod gmail_mime;
pub mod gmail_scanner;
pub mod ledger;
pub mod llm_luna;
pub mod refresh_phase;
pub mod refresh_progress;
pub mod scanner_daemon;
pub mod server;
pub mod slop_detector;
pub mod static_files;
pub mod workiq_mcp;
