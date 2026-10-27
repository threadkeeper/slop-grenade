//! Strict, bounded transient MIME decoding; attachment bodies and snippets are ignored.

use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine,
};
use serde::Deserialize;
use zeroize::Zeroizing;

use crate::gmail_error::GmailError;
use crate::slop_detector::{M365App, MessageDirection, MessageSample};

const MAX_BODY_BYTES: usize = 128 * 1024;
const MAX_PARTS: usize = 128;
const MAX_DEPTH: usize = 16;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_HTML_NODES: usize = 4096;
const MAX_HTML_DEPTH: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GmailMessage {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) label_ids: Vec<String>,
    internal_date: Option<String>,
    payload: Option<MimePart>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MimePart {
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    headers: Vec<Header>,
    #[serde(default)]
    body: MimeBody,
    #[serde(default)]
    parts: Vec<MimePart>,
}

#[derive(Deserialize)]
struct Header {
    name: String,
    value: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MimeBody {
    data: Option<Zeroizing<String>>,
    attachment_id: Option<String>,
    size: Option<usize>,
}

#[derive(Default)]
struct Decoded {
    plain: Zeroizing<String>,
    html: Zeroizing<String>,
    bytes: usize,
    parts: usize,
}

impl GmailMessage {
    pub(crate) fn sample(
        self,
        account_label: &str,
        key: String,
    ) -> Result<Option<MessageSample>, GmailError> {
        if excluded(&self.label_ids) {
            return Ok(None);
        }
        let payload = self.payload.ok_or(GmailError::InvalidResponse)?;
        let millis = self
            .internal_date
            .ok_or(GmailError::InvalidResponse)?
            .parse::<i64>()
            .map_err(|_| GmailError::InvalidResponse)?;
        let timestamp = chrono::DateTime::from_timestamp_millis(millis)
            .ok_or(GmailError::InvalidResponse)?
            .to_rfc3339();
        let mut decoded = Decoded::default();
        decode(&payload, 0, &mut decoded)?;
        let body = if !decoded.plain.trim().is_empty() {
            decoded.plain.to_string()
        } else if !decoded.html.trim().is_empty() {
            decoded.html.to_string()
        } else {
            return Ok(None);
        };
        if body.len() > MAX_BODY_BYTES {
            return Err(GmailError::LimitExceeded);
        }
        if body.trim().is_empty() {
            return Ok(None);
        }
        let sender = header(&payload, "from").unwrap_or_default().to_owned();
        let subject = header(&payload, "subject").unwrap_or_default().to_owned();
        let sent = self.label_ids.iter().any(|label| label == "SENT")
            || mailbox(&sender).eq_ignore_ascii_case(account_label);
        Ok(Some(MessageSample {
            message_id: key,
            app: M365App::Gmail,
            direction: if sent {
                MessageDirection::Sent
            } else {
                MessageDirection::Received
            },
            sender,
            subject_or_topic: subject,
            body,
            timestamp,
        }))
    }
}

pub(crate) fn excluded(labels: &[String]) -> bool {
    labels
        .iter()
        .any(|label| matches!(label.as_str(), "DRAFT" | "SPAM" | "TRASH"))
}

fn header<'a>(part: &'a MimePart, name: &str) -> Option<&'a str> {
    part.headers
        .iter()
        .find(|header| header.name.eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str())
}

fn mailbox(sender: &str) -> &str {
    sender
        .rsplit_once('<')
        .and_then(|(_, tail)| tail.strip_suffix('>'))
        .unwrap_or(sender)
        .trim()
}

fn decode(part: &MimePart, depth: usize, decoded: &mut Decoded) -> Result<(), GmailError> {
    decoded.parts += 1;
    if depth > MAX_DEPTH || decoded.parts > MAX_PARTS {
        return Err(GmailError::LimitExceeded);
    }
    let header_bytes = part.headers.iter().try_fold(0_usize, |sum, header| {
        sum.checked_add(header.name.len())
            .and_then(|sum| sum.checked_add(header.value.len()))
            .ok_or(GmailError::LimitExceeded)
    })?;
    if header_bytes > MAX_HEADER_BYTES {
        return Err(GmailError::LimitExceeded);
    }
    if !part.filename.is_empty()
        || part.body.attachment_id.is_some()
        || header(part, "content-disposition").is_some_and(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("attachment")
        })
    {
        return Ok(());
    }
    let mime = part.mime_type.split(';').next().unwrap_or("").trim();
    if mime.is_empty() || !mime.contains('/') {
        return Err(GmailError::InvalidResponse);
    }
    let is_text = mime.eq_ignore_ascii_case("text/plain") || mime.eq_ignore_ascii_case("text/html");
    let is_multipart = mime
        .get(..10)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("multipart/"));
    if (is_text && !part.parts.is_empty())
        || (is_multipart
            && (part.parts.is_empty()
                || part.body.data.is_some()
                || part.body.size.is_some_and(|size| size > 0)))
    {
        return Err(GmailError::InvalidResponse);
    }
    if is_text {
        if part.body.size.is_some_and(|size| size > MAX_BODY_BYTES) {
            return Err(GmailError::LimitExceeded);
        }
        match &part.body.data {
            Some(data) => {
                if data.len() > MAX_BODY_BYTES * 4 / 3 + 4 {
                    return Err(GmailError::LimitExceeded);
                }
                let bytes = Zeroizing::new(
                    URL_SAFE_NO_PAD
                        .decode(data.as_bytes())
                        .or_else(|_| URL_SAFE.decode(data.as_bytes()))
                        .map_err(|_| GmailError::InvalidResponse)?,
                );
                if part.body.size.is_some_and(|size| size != bytes.len()) {
                    return Err(GmailError::InvalidResponse);
                }
                decoded.bytes = decoded
                    .bytes
                    .checked_add(bytes.len())
                    .ok_or(GmailError::LimitExceeded)?;
                if decoded.bytes > MAX_BODY_BYTES {
                    return Err(GmailError::LimitExceeded);
                }
                let charset = charset(part)?;
                if charset.eq_ignore_ascii_case("us-ascii") && !bytes.is_ascii() {
                    return Err(GmailError::InvalidResponse);
                }
                let encoding = encoding_rs::Encoding::for_label(charset.as_bytes())
                    .ok_or(GmailError::InvalidResponse)?;
                let (text, errors) = encoding.decode_without_bom_handling(&bytes);
                if errors {
                    return Err(GmailError::InvalidResponse);
                }
                let target = if mime.eq_ignore_ascii_case("text/plain") {
                    &mut decoded.plain
                } else {
                    &mut decoded.html
                };
                if mime.eq_ignore_ascii_case("text/html") {
                    let html = Zeroizing::new(html_text(&text)?);
                    target.push_str(&html);
                } else {
                    target.push_str(&text);
                }
                target.push('\n');
                if target.len() > MAX_BODY_BYTES {
                    return Err(GmailError::LimitExceeded);
                }
            }
            None if part.body.size.is_some_and(|size| size > 0) => {
                return Err(GmailError::InvalidResponse)
            }
            None => {}
        }
    }
    for child in &part.parts {
        decode(child, depth + 1, decoded)?;
    }
    Ok(())
}

fn charset(part: &MimePart) -> Result<&str, GmailError> {
    let content_type = header(part, "content-type").unwrap_or(&part.mime_type);
    let mut charset = None;
    for parameter in content_type.split(';').skip(1) {
        let parameter = parameter.trim();
        let Some((key, value)) = parameter.split_once('=') else {
            if parameter.eq_ignore_ascii_case("charset") {
                return Err(GmailError::InvalidResponse);
            }
            continue;
        };
        if key.trim().eq_ignore_ascii_case("charset") {
            if charset.is_some() {
                return Err(GmailError::InvalidResponse);
            }
            let value = value.trim();
            let value = if value.starts_with('"') {
                value
                    .strip_prefix('"')
                    .and_then(|value| value.strip_suffix('"'))
                    .ok_or(GmailError::InvalidResponse)?
            } else {
                value
            };
            if value.is_empty() || value.contains('"') {
                return Err(GmailError::InvalidResponse);
            }
            charset = Some(value);
        }
    }
    Ok(charset.unwrap_or("utf-8"))
}

fn html_text(html: &str) -> Result<String, GmailError> {
    use std::io::Read;

    if html
        .bytes()
        .filter(|byte| *byte == b'<')
        .take(MAX_HTML_NODES + 1)
        .count()
        > MAX_HTML_NODES
    {
        return Err(GmailError::LimitExceeded);
    }
    let config = html2text::config::plain()
        .raw_mode(true)
        .link_footnotes(false);
    // Gmail commonly contains fragments, which need a doctype for strict parsing.
    let prefix = if html.to_ascii_lowercase().contains("<!doctype") {
        ""
    } else {
        "<!doctype html>"
    };
    let dom = config
        .parse_html(prefix.as_bytes().chain(html.as_bytes()))
        .map_err(|_| GmailError::InvalidResponse)?;
    if !dom.errors.borrow().is_empty() {
        return Err(GmailError::InvalidResponse);
    }
    let mut pending = vec![(dom.document.clone(), 0)];
    let mut count = 0;
    while let Some((node, depth)) = pending.pop() {
        count += 1;
        if count > MAX_HTML_NODES || depth > MAX_HTML_DEPTH {
            return Err(GmailError::LimitExceeded);
        }
        pending.extend(
            node.children
                .borrow()
                .iter()
                .map(|child| (child.clone(), depth + 1)),
        );
    }
    let tree = config
        .dom_to_render_tree(&dom)
        .map_err(|_| GmailError::InvalidResponse)?;
    let text = config
        .render_to_string(tree, 120)
        .map_err(|_| GmailError::InvalidResponse)?;
    if text.len() > MAX_BODY_BYTES {
        return Err(GmailError::LimitExceeded);
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(payload: serde_json::Value, labels: &[&str]) -> GmailMessage {
        serde_json::from_value(json!({
            "id": "synthetic", "labelIds": labels, "internalDate": "1793131200000",
            "snippet": "NEVER USE THIS RAW SNIPPET", "payload": payload,
        }))
        .expect("message")
    }

    fn text(mime: &str, body: &str) -> serde_json::Value {
        json!({"mimeType": mime, "body": {"data": URL_SAFE_NO_PAD.encode(body)}})
    }

    #[test]
    fn nested_plain_preferred_and_html_is_sanitized_fallback() {
        let payload = json!({"mimeType":"multipart/mixed","parts":[
            {"mimeType":"multipart/alternative","parts":[
                text("text/html", "<p>html &amp; text</p><script>hidden_script</script>"),
                text("text/plain", "original plain")
            ]}, {"mimeType":"text/plain","filename":"attachment.txt","body":{"data":"***"}}
        ]});
        let sample = message(payload, &["INBOX"])
            .sample("account@example.invalid", "key".into())
            .expect("decode")
            .expect("sample");
        assert_eq!(sample.body.trim(), "original plain");
        assert_eq!(sample.direction, MessageDirection::Received);
        let html = message(text("text/html", "<p>hello &amp; goodbye</p><script>hidden_script</script><style>hidden_style</style>"), &[])
            .sample("account@example.invalid", "key".into()).expect("decode").expect("sample");
        assert!(html.body.contains("hello & goodbye"));
        assert!(!html.body.contains("hidden_script"));
        assert!(!html.body.contains("hidden_style"));
        assert!(!html.body.contains("<p>"));
    }

    #[test]
    fn malformed_any_text_branch_fails_instead_of_partial_scoring() {
        let payload = json!({"mimeType":"multipart/alternative","parts":[
            text("text/plain", "valid"), {"mimeType":"text/html","body":{"data":"***"}}
        ]});
        assert!(matches!(
            message(payload, &[]).sample("a@example.invalid", "key".into()),
            Err(GmailError::InvalidResponse)
        ));
        let invalid_utf8 =
            json!({"mimeType":"text/plain","body":{"data": URL_SAFE_NO_PAD.encode([0xff])}});
        assert!(message(invalid_utf8, &[])
            .sample("a@example.invalid", "key".into())
            .is_err());
    }

    #[test]
    fn empty_attachment_only_and_excluded_messages_are_not_scored() {
        for payload in [
            text("text/plain", ""),
            json!({"mimeType":"application/pdf","body":{"attachmentId":"never-download","size":999999999}}),
            json!({"mimeType":"text/plain","filename":"body.txt","body":{"data":"***"}}),
        ] {
            assert!(message(payload, &[])
                .sample("a@example.invalid", "key".into())
                .expect("empty")
                .is_none());
        }
        for label in ["DRAFT", "SPAM", "TRASH"] {
            assert!(message(text("text/plain", "body"), &[label])
                .sample("a@example.invalid", "key".into())
                .expect("excluded")
                .is_none());
        }
        assert_eq!(
            message(text("text/plain", "body"), &["SENT"])
                .sample("a@example.invalid", "key".into())
                .expect("sent")
                .expect("sample")
                .direction,
            MessageDirection::Sent
        );
    }

    #[test]
    fn missing_text_data_and_decode_limits_fail_closed() {
        assert!(
            message(json!({"mimeType":"text/plain","body":{"size":2}}), &[])
                .sample("a@example.invalid", "key".into())
                .is_err()
        );
        assert!(matches!(
            message(text("text/plain", &"x".repeat(MAX_BODY_BYTES + 1)), &[])
                .sample("a@example.invalid", "key".into()),
            Err(GmailError::LimitExceeded)
        ));
        let mut nested = text("text/plain", "body");
        for _ in 0..MAX_DEPTH + 1 {
            nested = json!({"mimeType":"multipart/mixed","parts":[nested]});
        }
        assert!(matches!(
            message(nested, &[]).sample("a@example.invalid", "key".into()),
            Err(GmailError::LimitExceeded)
        ));
    }

    #[test]
    fn charsets_are_strict_and_body_size_and_structure_cannot_silently_truncate() {
        let latin = json!({"mimeType":"text/plain","headers":[
            {"name":"Content-Type","value":"text/plain; charset=\"windows-1252\""}
        ],"body":{"data": URL_SAFE_NO_PAD.encode(b"caf\xe9"),"size":4}});
        let sample = message(latin, &[])
            .sample("a@example.invalid", "key".into())
            .expect("charset")
            .expect("sample");
        assert_eq!(sample.body.trim(), "café");
        for content_type in [
            "text/plain; charset=unknown-synthetic",
            "text/plain; charset",
            "text/plain; charset=\"utf-8",
            "text/plain; charset=utf-8; charset=windows-1252",
            "text/plain; charset=us-ascii",
        ] {
            let payload = json!({"mimeType":"text/plain","headers":[
                {"name":"Content-Type","value":content_type}
            ],"body":{"data":URL_SAFE_NO_PAD.encode([0xe9])}});
            assert!(matches!(
                message(payload, &[]).sample("a@example.invalid", "key".into()),
                Err(GmailError::InvalidResponse)
            ));
        }
        for payload in [
            json!({"body":{"data":URL_SAFE_NO_PAD.encode("untyped body")}}),
            json!({"mimeType":"text/plain","body":{"data":URL_SAFE_NO_PAD.encode("truncated"),"size":100}}),
            json!({"mimeType":"text/plain","body":{"data":URL_SAFE_NO_PAD.encode("unexpected"),"size":0}}),
            json!({"mimeType":"text/plain","parts":[text("text/plain","child")]}),
            json!({"mimeType":"multipart/mixed","parts":[]}),
            json!({"mimeType":"multipart/mixed","body":{"data":"***"},"parts":[text("text/plain","child")]}),
        ] {
            assert!(matches!(
                message(payload, &[]).sample("a@example.invalid", "key".into()),
                Err(GmailError::InvalidResponse)
            ));
        }
    }

    #[test]
    fn malformed_html_and_nested_header_and_html_resource_limits_fail_closed() {
        for html in [
            "<p>valid</p><broken",
            "<div><b>unclosed",
            "<!-- unterminated",
        ] {
            let payload = json!({"mimeType":"multipart/alternative","parts":[
                text("text/plain", "valid plain must not mask corrupt HTML"), text("text/html", html)
            ]});
            assert!(matches!(
                message(payload, &[]).sample("a@example.invalid", "key".into()),
                Err(GmailError::InvalidResponse)
            ));
        }
        let nested = format!(
            "{}bounded text{}",
            "<div>".repeat(MAX_HTML_DEPTH + 1),
            "</div>".repeat(MAX_HTML_DEPTH + 1)
        );
        assert!(matches!(
            message(text("text/html", &nested), &[]).sample("a@example.invalid", "key".into()),
            Err(GmailError::LimitExceeded)
        ));
        let many = "<br>".repeat(MAX_HTML_NODES + 1);
        assert!(matches!(
            message(text("text/html", &many), &[]).sample("a@example.invalid", "key".into()),
            Err(GmailError::LimitExceeded)
        ));
        let huge_header = json!({"mimeType":"multipart/mixed","parts":[{
            "mimeType":"text/plain","headers":[{"name":"X-Synthetic","value":"x".repeat(MAX_HEADER_BYTES)}],
            "body":{"data":URL_SAFE_NO_PAD.encode("body")}
        }]});
        assert!(matches!(
            message(huge_header, &[]).sample("a@example.invalid", "key".into()),
            Err(GmailError::LimitExceeded)
        ));
    }

    #[test]
    fn archived_self_authored_and_inbox_directions_use_labels_and_account_identity() {
        for (labels, sender, expected) in [
            (
                vec!["INBOX"],
                "Other <other@example.invalid>",
                MessageDirection::Received,
            ),
            (
                vec![],
                "Other <other@example.invalid>",
                MessageDirection::Received,
            ),
            (vec![], "Self <ONE@EXAMPLE.INVALID>", MessageDirection::Sent),
            (
                vec!["SENT"],
                "alias@example.invalid",
                MessageDirection::Sent,
            ),
        ] {
            let mut payload = text("text/plain", "synthetic");
            payload["headers"] = json!([{"name":"From","value":sender}]);
            assert_eq!(
                message(payload, &labels)
                    .sample("one@example.invalid", "key".into())
                    .expect("decode")
                    .expect("sample")
                    .direction,
                expected
            );
        }
    }
}
