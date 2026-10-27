//! Typed, read-only Gmail REST requests with bounded pages and message counts.

use std::collections::HashSet;

use serde::Deserialize;

use crate::gmail_auth::{valid_history_id, GmailProfile};
use crate::gmail_error::GmailError;
use crate::gmail_http::GoogleHttp;
use crate::gmail_mime::{excluded, GmailMessage};

const MAX_PAGES: usize = 10;
pub(crate) const MAX_MESSAGES: usize = 200;
const MAX_PAGE_TOKEN: usize = 2048;
const MESSAGE_FIELDS: &str =
    "id,labelIds,internalDate,payload(mimeType,filename,headers,body,parts)";

/// Read-only production Gmail REST client; it never fetches threads or attachments.
pub struct GmailClient {
    http: GoogleHttp,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagePage {
    #[serde(default)]
    messages: Vec<MessageId>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct MessageId {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryPage {
    #[serde(default)]
    history: Vec<HistoryEntry>,
    history_id: String,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    #[serde(default)]
    messages_added: Vec<AddedMessage>,
}

#[derive(Deserialize)]
struct AddedMessage {
    message: HistoryMessage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryMessage {
    id: String,
    #[serde(default)]
    label_ids: Vec<String>,
}

pub(crate) struct HistoryBatch {
    pub(crate) ids: Vec<String>,
    pub(crate) history_id: String,
}

impl GmailClient {
    /// Create a TLS-verified client with fixed Google endpoints and no proxy support.
    pub fn new() -> Result<Self, GmailError> {
        Ok(Self {
            http: GoogleHttp::production()?,
        })
    }

    pub(crate) fn with_http(http: GoogleHttp) -> Self {
        Self { http }
    }

    pub(crate) fn for_account(&self, id: &str) -> Self {
        Self::with_http(self.http.for_account(id))
    }

    pub(crate) async fn profile(&self, access: &str) -> Result<GmailProfile, GmailError> {
        GmailProfile::fetch(&self.http, access).await
    }

    pub(crate) async fn initial_ids(&self, access: &str) -> Result<Vec<String>, GmailError> {
        let mut ids = Vec::new();
        let mut seen = HashSet::new();
        let mut tokens = HashSet::new();
        let mut token: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut request = self.http.get("/messages", access).query(&[
                ("q", "newer_than:7d -in:drafts -in:spam -in:trash"),
                ("includeSpamTrash", "false"),
                ("maxResults", "100"),
                ("fields", "messages/id,nextPageToken"),
            ]);
            if let Some(token) = &token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: MessagePage = self.http.json(request, true).await?;
            for message in page.messages {
                add_id(message.id, &mut ids, &mut seen)?;
            }
            token = next_token(page.next_page_token, &mut tokens)?;
            if token.is_none() {
                return Ok(ids);
            }
        }
        Err(GmailError::LimitExceeded)
    }

    pub(crate) async fn history(
        &self,
        access: &str,
        start: &str,
    ) -> Result<HistoryBatch, GmailError> {
        if !valid_history_id(start) {
            return Err(GmailError::InvalidResponse);
        }
        let mut ids = Vec::new();
        let mut seen = HashSet::new();
        let mut tokens = HashSet::new();
        let mut token: Option<String> = None;
        let mut newest = start
            .parse::<u128>()
            .map_err(|_| GmailError::InvalidResponse)?;
        for _ in 0..MAX_PAGES {
            let mut request = self.http.get("/history", access).query(&[
                ("startHistoryId", start),
                ("historyTypes", "messageAdded"),
                ("maxResults", "100"),
                (
                    "fields",
                    "history(messagesAdded/message(id,labelIds)),historyId,nextPageToken",
                ),
            ]);
            if let Some(token) = &token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: HistoryPage = self.http.json(request, true).await?;
            let history_id = page
                .history_id
                .parse::<u128>()
                .map_err(|_| GmailError::InvalidResponse)?;
            if !valid_history_id(&page.history_id) || history_id < newest {
                return Err(GmailError::InvalidResponse);
            }
            newest = history_id;
            for entry in page.history {
                for added in entry.messages_added {
                    if !excluded(&added.message.label_ids) {
                        add_id(added.message.id, &mut ids, &mut seen)?;
                    }
                }
            }
            token = next_token(page.next_page_token, &mut tokens)?;
            if token.is_none() {
                return Ok(HistoryBatch {
                    ids,
                    history_id: page.history_id,
                });
            }
        }
        Err(GmailError::LimitExceeded)
    }

    pub(crate) async fn message(&self, access: &str, id: &str) -> Result<GmailMessage, GmailError> {
        if !valid_message_id(id) {
            return Err(GmailError::InvalidResponse);
        }
        let message: GmailMessage = self
            .http
            .json(
                self.http
                    .get(&format!("/messages/{id}"), access)
                    .query(&[("format", "full"), ("fields", MESSAGE_FIELDS)]),
                true,
            )
            .await
            .map_err(|error| {
                // A deleted message is a failed batch, not an expired history cursor.
                if error == GmailError::HistoryExpired {
                    GmailError::InvalidResponse
                } else {
                    error
                }
            })?;
        if message.id != id {
            return Err(GmailError::InvalidResponse);
        }
        Ok(message)
    }
}

fn valid_message_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn add_id(id: String, ids: &mut Vec<String>, seen: &mut HashSet<String>) -> Result<(), GmailError> {
    if !valid_message_id(&id) {
        return Err(GmailError::InvalidResponse);
    }
    if seen.insert(id.clone()) {
        ids.push(id);
        if ids.len() > MAX_MESSAGES {
            return Err(GmailError::LimitExceeded);
        }
    }
    Ok(())
}

fn next_token(
    token: Option<String>,
    seen: &mut HashSet<String>,
) -> Result<Option<String>, GmailError> {
    if let Some(token) = &token {
        if token.is_empty() || token.len() > MAX_PAGE_TOKEN || !seen.insert(token.clone()) {
            return Err(GmailError::LimitExceeded);
        }
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_ids_pagination_cycles_and_message_overflow_fail_closed() {
        assert!(!valid_message_id("../profile?token=bad"));
        let mut tokens = HashSet::new();
        assert!(next_token(Some("one".into()), &mut tokens).is_ok());
        assert_eq!(
            next_token(Some("one".into()), &mut tokens),
            Err(GmailError::LimitExceeded)
        );
        let mut ids = Vec::new();
        let mut seen = HashSet::new();
        for i in 0..MAX_MESSAGES {
            add_id(format!("id{i}"), &mut ids, &mut seen).expect("id");
        }
        assert_eq!(
            add_id("overflow".into(), &mut ids, &mut seen),
            Err(GmailError::LimitExceeded)
        );
    }
}
