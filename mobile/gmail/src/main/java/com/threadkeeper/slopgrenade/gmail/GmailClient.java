package com.threadkeeper.slopgrenade.gmail;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.charset.Charset;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.time.Instant;
import java.time.Clock;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Ephemeral Gmail REST connector. No message content or bearer token is persisted. */
public final class GmailClient {
    public static final String FULL = "/messages?maxResults=500&includeSpamTrash=false&q=";
    private static final long SEVEN_DAYS_MILLIS = 7L * 24 * 60 * 60 * 1000;
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private final Transport transport;
    private final Sleeper sleeper;
    private final Clock clock;
    public interface Transport { JSONObject get(String path) throws Failure; }
    public interface Sleeper { void sleep(long millis) throws InterruptedException; }
    /** API-30-compatible immutable holder; no Record runtime or content-bearing generated toString. */
    public static final class Batch {
        private final JSONArray samples;
        private final String historyId;
        private final boolean resynced;
        public Batch(JSONArray samples, String historyId, boolean resynced) {
            this.samples=samples; this.historyId=historyId; this.resynced=resynced;
        }
        public JSONArray samples() { return samples; }
        public String historyId() { return historyId; }
        public boolean resynced() { return resynced; }
    }
    /** Sanitized transport failure, intentionally excludes server response content. */
    public static final class Failure extends IOException {
        public final int status;
        public final long retryAfterSeconds;
        public Failure(int status, long retryAfterSeconds) {
            super("Gmail request failed ("+status+")");
            this.status = status; this.retryAfterSeconds = retryAfterSeconds;
        }
        public boolean requiresReconnect() { return status == 401 || status == 403; }
    }
    public GmailClient(Transport transport) { this(transport, Thread::sleep); }
    public GmailClient(Transport transport, Sleeper sleeper) {
        this(transport,sleeper,Clock.systemUTC());
    }
    public GmailClient(Transport transport, Sleeper sleeper, Clock clock) {
        this.transport = transport; this.sleeper = sleeper; this.clock = clock;
    }
    /** Returns a complete batch only; callers must commit the checkpoint after successful ingest. */
    public Batch scan(String accountId, String checkpoint) throws Failure, InterruptedException {
        long end = clock.millis();
        return scanWithinWindow(accountId,checkpoint,end-SEVEN_DAYS_MILLIS,end);
    }
    private Batch scanWithinWindow(String accountId, String checkpoint, long start, long end) throws Failure, InterruptedException {
        boolean full = checkpoint == null;
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        String watermark;
        try {
            watermark = full ? get("/profile").getString("historyId") : checkpoint;
            String base = full ? fullQuery(start,end) : "/history?startHistoryId="+encode(checkpoint)+"&maxResults=500";
            String next = "";
            Set<String> pages = new HashSet<>();
            do {
                if (!pages.add(next)) throw new Failure(502,0);
                JSONObject page = get(base+(next.isEmpty() ? "" : "&pageToken="+encode(next)));
                if (full) collect(page.optJSONArray("messages"),ids,false);
                else {
                    watermark = page.optString("historyId",watermark);
                    JSONArray history = page.optJSONArray("history");
                    if (history != null) for (int i=0;i<history.length();i++) {
                        JSONObject event = history.getJSONObject(i);
                        for (String kind : List.of("messagesAdded","labelsAdded","labelsRemoved"))
                            collect(event.optJSONArray(kind),ids,true);
                    }
                }
                next = page.optString("nextPageToken","");
            } while (!next.isEmpty());
        } catch (Failure e) {
            if (!full && e.status == 404) {
                Batch b = scanWithinWindow(accountId,null,start,end);
                return new Batch(b.samples(),b.historyId(),true);
            }
            throw e;
        }
        JSONArray samples = new JSONArray();
        boolean deferredFutureHistory = false;
        for (String id : ids) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            try {
                JSONObject message = get("/messages/"+encode(id)+"?format=full");
                long timestamp;
                try { timestamp=Long.parseLong(message.getString("internalDate")); }
                catch (RuntimeException e) { throw new Failure(422,0); }
                // Apply the same fixed window to history label events as to full pages.
                // In particular, marking years-old mail unread must not create new effects.
                if (timestamp > end) {
                    // History may grow while paging. Keep the cursor so newly arrived mail
                    // beyond this scan's fixed end can be picked up on the next scan.
                    deferredFutureHistory = !full;
                    continue;
                }
                if (timestamp <= start) continue;
                JSONArray labels = message.optJSONArray("labelIds");
                boolean excluded = false;
                if (labels != null) for (int i=0;i<labels.length();i++)
                    if (Set.of("DRAFT","SPAM","TRASH").contains(labels.getString(i))) excluded=true;
                if (!excluded) {
                    JSONObject payload=message.optJSONObject("payload");
                    if (payload != null) resolveInlineBodies(id,payload);
                    samples.put(sample(accountId,message));
                }
            } catch (Failure e) {
                if (e.status != 404) throw e; // Deleted between listing and fetch.
            }
        }
        return new Batch(samples,deferredFutureHistory ? checkpoint : watermark,full);
    }
    private static String fullQuery(long start, long end) {
        // Widen coarse Gmail second bounds by at most one second; enforce exact milliseconds locally.
        return FULL+encode("after:"+(Math.floorDiv(start,1000L)-1)+" before:"+(Math.floorDiv(end,1000L)+1)
            +" -in:drafts -in:spam -in:trash");
    }
    private void resolveInlineBodies(String messageId, JSONObject part) throws Failure, InterruptedException {
        if (isAttachment(part)) return;
        JSONArray parts=part.optJSONArray("parts");
        if (parts != null) {
            if ("multipart/alternative".equals(part.optString("mimeType"))) {
                for (int i=0;i<parts.length();i++) {
                    JSONObject child=parts.getJSONObject(i);
                    if ("text/plain".equals(child.optString("mimeType")) && !isAttachment(child)) {
                        resolveInlineBodies(messageId,child);
                        if (!mimeText(child).trim().isEmpty()) return;
                    }
                }
                for (int i=parts.length()-1;i>=0;i--) {
                    JSONObject child=parts.getJSONObject(i);
                    resolveInlineBodies(messageId,child);
                    if (!mimeText(child).trim().isEmpty()) return;
                }
                return;
            }
            for (int i=0;i<parts.length();i++) resolveInlineBodies(messageId,parts.getJSONObject(i));
            return;
        }
        if (!Set.of("text/plain","text/html").contains(part.optString("mimeType",""))) return;
        JSONObject body=part.optJSONObject("body");
        if (body == null || body.has("data") || body.optString("attachmentId","").isEmpty()) return;
        JSONObject fetched;
        try {
            fetched=get("/messages/"+encode(messageId)+"/attachments/"+encode(body.getString("attachmentId")));
        } catch (Failure e) {
            // A missing text-body attachment is not a deleted message and cannot be skipped.
            if (e.status == 404) throw new Failure(422,0);
            throw e;
        }
        body.put("data",fetched.optString("data",""));
    }
    private static void collect(JSONArray values, Set<String> ids, boolean nested) {
        if (values == null) return;
        for (int i=0;i<values.length();i++) {
            JSONObject value = values.getJSONObject(i);
            String id = (nested ? value.getJSONObject("message") : value).optString("id","");
            if (!id.isEmpty()) ids.add(id);
        }
    }
    private JSONObject get(String path) throws Failure, InterruptedException {
        for (int attempt=0;;attempt++) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            try { return transport.get(path); }
            catch (Failure e) {
                if (attempt >= 3 || !(e.status == 429 || e.status >= 500)) throw e;
                sleeper.sleep(Math.min(60_000,Math.max(1000L << attempt,e.retryAfterSeconds*1000)));
            }
        }
    }
    public static JSONObject sample(String accountId, JSONObject message) throws Failure {
        JSONObject payload = message.optJSONObject("payload");
        String text = payload == null ? "" : mimeText(payload);
        if (text.trim().isEmpty()) throw new Failure(422,0);
        String sender="", subject="";
        if (payload != null) {
            JSONArray headers=payload.optJSONArray("headers");
            if (headers != null) for (int i=0;i<headers.length();i++) {
                JSONObject h=headers.getJSONObject(i);
                if ("from".equalsIgnoreCase(h.optString("name"))) sender=h.optString("value");
                if ("subject".equalsIgnoreCase(h.optString("name"))) subject=h.optString("value");
            }
        }
        boolean sent=false;
        JSONArray labels=message.optJSONArray("labelIds");
        if (labels != null) for (int i=0;i<labels.length();i++)
            sent |= "SENT".equals(labels.optString(i));
        return new JSONObject().put("messageId",accountId+":"+message.getString("id")).put("app","gmail")
            .put("direction",sent ? "sent" : "received").put("sender",sender)
            .put("subjectOrTopic",subject).put("body",text)
            .put("timestamp",Instant.ofEpochMilli(Long.parseLong(message.getString("internalDate"))).toString());
    }
    /** Prefers text/plain alternatives, ignores attachments, and strips inert HTML fallback. */
    public static String mimeText(JSONObject part) throws Failure {
        if (isAttachment(part)) return "";
        String type=part.optString("mimeType","");
        JSONArray parts=part.optJSONArray("parts");
        if (parts != null) {
            if ("multipart/alternative".equals(type)) {
                for (int i=0;i<parts.length();i++) {
                    JSONObject child=parts.getJSONObject(i);
                    if ("text/plain".equals(child.optString("mimeType"))) {
                        String text=mimeText(child); if (!text.trim().isEmpty()) return text;
                    }
                }
                for (int i=parts.length()-1;i>=0;i--) {
                    String text=mimeText(parts.getJSONObject(i)); if (!text.trim().isEmpty()) return text;
                }
                return "";
            }
            StringJoiner joined=new StringJoiner("\n");
            for (int i=0;i<parts.length();i++) {
                String text=mimeText(parts.getJSONObject(i)); if (!text.trim().isEmpty()) joined.add(text);
            }
            return joined.toString();
        }
        if (!type.equals("text/plain") && !type.equals("text/html")) return "";
        JSONObject body=part.optJSONObject("body");
        if (body == null) return "";
        try {
            byte[] decoded=Base64.getUrlDecoder().decode(body.optString("data",""));
            String text=charset(part).newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(decoded)).toString();
            if (type.equals("text/html")) text=text.replaceAll("(?is)<(script|style)\\b[^>]*>.*?</\\1>","")
                .replaceAll("(?s)<[^>]*>"," ").replace("&nbsp;"," ").replace("&lt;","<")
                .replace("&gt;",">").replace("&quot;","\"").replace("&#39;","'").replace("&amp;","&")
                .replaceAll("\\s+"," ").trim();
            return text;
        } catch (IllegalArgumentException | CharacterCodingException e) { throw new Failure(422,0); }
    }
    private static boolean isAttachment(JSONObject part) {
        if (!part.optString("filename","").isEmpty()) return true;
        JSONArray headers=part.optJSONArray("headers");
        if (headers != null) for (int i=0;i<headers.length();i++) {
            JSONObject header=headers.getJSONObject(i);
            if (!"Content-Disposition".equalsIgnoreCase(header.optString("name"))) continue;
            String value=header.optString("value").trim();
            if ("attachment".equalsIgnoreCase(value.split(";",2)[0].trim()) ||
                Pattern.compile("(?i)(?:^|;)\\s*filename\\*?\\s*=").matcher(value).find()) return true;
        }
        return false;
    }
    private static Charset charset(JSONObject part) throws Failure {
        JSONArray headers=part.optJSONArray("headers");
        if (headers != null) for (int i=0;i<headers.length();i++) {
            JSONObject header=headers.getJSONObject(i);
            if (!"Content-Type".equalsIgnoreCase(header.optString("name"))) continue;
            Matcher m=Pattern.compile("(?i)charset\\s*=\\s*[\"']?([^\\s;\"']+)").matcher(header.optString("value"));
            if (m.find()) {
                try { return Charset.forName(m.group(1)); }
                catch (IllegalArgumentException ignored) { throw new Failure(422,0); }
            }
        }
        return StandardCharsets.UTF_8;
    }
    private static String encode(String text) {
        try { return URLEncoder.encode(text,"UTF-8"); }
        catch (UnsupportedEncodingException impossible) { throw new AssertionError(impossible); }
    }
    static Failure httpFailure(int status, JSONObject payload, long delay) {
        JSONObject error=payload.optJSONObject("error");
        JSONArray errors=error == null ? null : error.optJSONArray("errors");
        if (status == 403 && errors != null) for (int i=0;i<errors.length();i++) {
            String reason=errors.getJSONObject(i).optString("reason");
            if (Set.of("rateLimitExceeded","userRateLimitExceeded","quotaExceeded","dailyLimitExceeded").contains(reason))
                return new Failure(429,delay);
        }
        return new Failure(status,delay);
    }
    /** HTTPS-only REST transport; bearer credentials remain in this short-lived instance. */
    public static Transport https(String accessToken) {
        return path -> {
            HttpURLConnection connection=null;
            try {
                if (!path.startsWith("/") || path.contains("://")) throw new Failure(400,0);
                connection=(HttpURLConnection)new URL("https://gmail.googleapis.com/gmail/v1/users/me"+path).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(20_000); connection.setReadTimeout(30_000);
                connection.setRequestProperty("Authorization","Bearer "+accessToken);
                connection.setRequestProperty("Accept","application/json");
                int status=connection.getResponseCode();
                if (status != 200) {
                    long delay=0;
                    try { delay=Long.parseLong(connection.getHeaderField("Retry-After")); }
                    catch (NumberFormatException ignored) { /* Optional header. */ }
                    JSONObject error=new JSONObject();
                    // Inspect only quota reason codes in a bounded ephemeral error envelope.
                    if (status == 403 && connection.getErrorStream() != null) {
                        try (InputStream input=connection.getErrorStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                            byte[] buffer=new byte[4096]; int n;
                            while ((n=input.read(buffer)) != -1 && out.size()+n <= 65536) out.write(buffer,0,n);
                            try { error=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8)); }
                            catch (RuntimeException ignored) { /* Unknown error remains a permission failure. */ }
                        }
                    }
                    throw httpFailure(status,error,Math.max(0,Math.min(60,delay)));
                }
                try (InputStream input=connection.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                    byte[] buffer=new byte[8192]; int n;
                    while ((n=input.read(buffer)) != -1) {
                        if (out.size()+n > MAX_BYTES) throw new Failure(413,0);
                        out.write(buffer,0,n);
                    }
                    return new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
                }
            } catch (Failure e) { throw e; }
            catch (IOException | RuntimeException e) { throw new Failure(503,0); }
            finally { if (connection != null) connection.disconnect(); }
        };
    }
}
