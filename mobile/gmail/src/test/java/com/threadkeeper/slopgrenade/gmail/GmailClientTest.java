package com.threadkeeper.slopgrenade.gmail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class GmailClientTest {
    private static JSONObject json(String value) { return new JSONObject(value); }
    private static JSONObject message(String id, String labels) {
        return json("{\"id\":\""+id+"\",\"labelIds\":"+labels+",\"internalDate\":\"1000\","
            +"\"payload\":{\"mimeType\":\"text/plain\",\"headers\":[{\"name\":\"From\",\"value\":\"synthetic@example.invalid\"}],"
            +"\"body\":{\"data\":\"SGVsbG8\"}}}");
    }
    private static final class Fake implements GmailClient.Transport {
        final Map<String, Queue<Object>> responses = new LinkedHashMap<>();
        final List<String> calls = new ArrayList<>();
        Fake at(String path, Object... values) {
            responses.put(path, new LinkedList<>(Arrays.asList(values))); return this;
        }
        public JSONObject get(String path) throws GmailClient.Failure {
            calls.add(path);
            Queue<Object> queue = responses.get(path);
            if (queue == null || queue.isEmpty()) throw new AssertionError("Unexpected request: "+path);
            Object value = queue.remove();
            if (value instanceof GmailClient.Failure) throw (GmailClient.Failure)value;
            return (JSONObject)value;
        }
    }
    @Test public void fullCapturesWatermarkBeforePagingAndDeduplicates() throws Exception {
        Fake f = new Fake().at("/profile", json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL, json("{\"messages\":[{\"id\":\"a\"}],\"nextPageToken\":\"p\"}"))
            .at(GmailClient.FULL+"&pageToken=p", json("{\"messages\":[{\"id\":\"a\"},{\"id\":\"b\"}]}"))
            .at("/messages/a?format=full", message("a","[\"SENT\"]"))
            .at("/messages/b?format=full", message("b","[\"INBOX\"]"));
        GmailClient.Batch batch = new GmailClient(f).scan("hashed", null);
        assertEquals("/profile", f.calls.get(0));
        assertEquals("10", batch.historyId());
        assertEquals(2, batch.samples().length());
        assertEquals("hashed:a", batch.samples().getJSONObject(0).getString("messageId"));
        assertEquals("sent", batch.samples().getJSONObject(0).getString("direction"));
        assertEquals("received", batch.samples().getJSONObject(1).getString("direction"));
    }
    @Test public void filtersForbiddenLabelsButIncludesArchive() throws Exception {
        Fake f = new Fake().at("/profile", json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL, json("{\"messages\":[{\"id\":\"a\"},{\"id\":\"b\"},{\"id\":\"c\"},{\"id\":\"d\"}]}"))
            .at("/messages/a?format=full", message("a","[\"DRAFT\"]"))
            .at("/messages/b?format=full", message("b","[\"SPAM\"]"))
            .at("/messages/c?format=full", message("c","[\"TRASH\"]"))
            .at("/messages/d?format=full", message("d","[]"));
        assertEquals(1,new GmailClient(f).scan("account",null).samples().length());
    }
    @Test public void historyPagesAndLabelChangesAreDeduplicated() throws Exception {
        Fake f = new Fake()
            .at("/history?startHistoryId=10&maxResults=500",json("{\"historyId\":\"12\",\"history\":[{\"messagesAdded\":[{\"message\":{\"id\":\"a\"}}]}],\"nextPageToken\":\"x\"}"))
            .at("/history?startHistoryId=10&maxResults=500&pageToken=x",json("{\"historyId\":\"13\",\"history\":[{\"labelsAdded\":[{\"message\":{\"id\":\"a\"}},{\"message\":{\"id\":\"b\"}}]}]}"))
            .at("/messages/a?format=full",message("a","[]"))
            .at("/messages/b?format=full",new GmailClient.Failure(404,0));
        GmailClient.Batch b = new GmailClient(f).scan("one","10");
        assertEquals("13",b.historyId()); assertEquals(1,b.samples().length()); assertFalse(b.resynced());
    }
    @Test public void expiredHistoryResyncsOnce() throws Exception {
        Fake f = new Fake().at("/history?startHistoryId=1&maxResults=500",new GmailClient.Failure(404,0))
            .at("/profile",json("{\"historyId\":\"42\"}"))
            .at(GmailClient.FULL,json("{}"));
        GmailClient.Batch b = new GmailClient(f).scan("one","1");
        assertTrue(b.resynced()); assertEquals("42",b.historyId());
    }
    @Test public void retriesTransientButNeverAuth() throws Exception {
        List<Long> sleeps = new ArrayList<>();
        Fake f = new Fake().at("/profile",new GmailClient.Failure(429,2),json("{\"historyId\":\"2\"}"))
            .at(GmailClient.FULL,json("{}"));
        new GmailClient(f,sleeps::add).scan("a",null);
        assertEquals(List.of(2000L),sleeps);
        Fake auth = new Fake().at("/profile",new GmailClient.Failure(401,0));
        try { new GmailClient(auth,sleeps::add).scan("a",null); fail(); }
        catch (GmailClient.Failure e) { assertTrue(e.requiresReconnect()); }
        assertEquals(1,auth.calls.size());
    }
    @Test public void failedPageReturnsNoCheckpointOrPartialBatch() throws Exception {
        Fake f = new Fake().at("/profile",json("{\"historyId\":\"5\"}"))
            .at(GmailClient.FULL,json("{\"nextPageToken\":\"p\",\"messages\":[{\"id\":\"a\"}]}"))
            .at(GmailClient.FULL+"&pageToken=p",new GmailClient.Failure(403,0));
        try { new GmailClient(f).scan("a",null); fail(); }
        catch (GmailClient.Failure e) { assertEquals(403,e.status); }
    }
    @Test public void mimePrefersPlainAndSkipsAttachments() {
        JSONObject payload=json("{\"mimeType\":\"multipart/mixed\",\"parts\":["
            +"{\"mimeType\":\"multipart/alternative\",\"parts\":["
            +"{\"mimeType\":\"text/html\",\"body\":{\"data\":\"PGI-SGk8L2I-\"}},"
            +"{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"SGk\"}}]},"
            +"{\"mimeType\":\"text/plain\",\"filename\":\"private.txt\",\"body\":{\"data\":\"c2VjcmV0\"}}]}");
        assertEquals("Hi", GmailClient.mimeText(payload));
    }
    @Test public void htmlFallbackMalformedAndAccountIsolation() throws Exception {
        assertEquals("Hello & bye",GmailClient.mimeText(json("{\"mimeType\":\"text/html\",\"body\":{\"data\":\"PHA-SGVsbG8gJmFtcDsgYnllPC9wPg\"}}")));
        assertEquals("",GmailClient.mimeText(json("{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"!\"}}")));
        assertNotEquals(GmailClient.sample("one",message("a","[]")).getString("messageId"),
            GmailClient.sample("two",message("a","[]")).getString("messageId"));
    }
    @Test public void inlineTextAttachmentIsFetchedButBinaryAttachmentIsNot() throws Exception {
        JSONObject m=message("a","[]");
        m.put("payload",json("{\"mimeType\":\"multipart/mixed\",\"parts\":["
            +"{\"mimeType\":\"text/plain\",\"body\":{\"attachmentId\":\"text\"}},"
            +"{\"mimeType\":\"application/pdf\",\"filename\":\"private.pdf\",\"body\":{\"attachmentId\":\"binary\"}}]}"));
        Fake f=new Fake().at("/profile",json("{\"historyId\":\"1\"}"))
            .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
            .at("/messages/a?format=full",m)
            .at("/messages/a/attachments/text",json("{\"data\":\"SGVsbG8\"}"));
        assertEquals("Hello",new GmailClient(f).scan("one",null).samples().getJSONObject(0).getString("body"));
    }
    @Test public void honorsDeclaredCharsetAndStripsExecutableHtml() {
        assertEquals("café", GmailClient.mimeText(json("{\"mimeType\":\"text/plain\","
            +"\"headers\":[{\"name\":\"Content-Type\",\"value\":\"text/plain; charset=ISO-8859-1\"}],"
            +"\"body\":{\"data\":\"Y2Fm6Q\"}}")));
        assertEquals("Hello",GmailClient.mimeText(json("{\"mimeType\":\"text/html\","
            +"\"body\":{\"data\":\"PHNjcmlwdD5zZWNyZXQ8L3NjcmlwdD48cD5IZWxsbzwvcD4\"}}")));
    }
    @Test public void repeatedPageAndRetryExhaustionFailWithoutPartialBatch() throws Exception {
        Fake repeated=new Fake().at("/profile",json("{\"historyId\":\"1\"}"))
            .at(GmailClient.FULL,json("{\"nextPageToken\":\"p\"}"))
            .at(GmailClient.FULL+"&pageToken=p",json("{\"nextPageToken\":\"p\"}"));
        try { new GmailClient(repeated, ignored -> {}).scan("a",null); fail(); }
        catch (GmailClient.Failure e) { assertEquals(502,e.status); }
        List<Long> sleeps=new ArrayList<>();
        Fake exhausted=new Fake().at("/profile",new GmailClient.Failure(503,0),new GmailClient.Failure(503,0),
            new GmailClient.Failure(503,0),new GmailClient.Failure(503,0));
        try { new GmailClient(exhausted,sleeps::add).scan("a",null); fail(); }
        catch (GmailClient.Failure e) { assertEquals(503,e.status); }
        assertEquals(List.of(1000L,2000L,4000L),sleeps);
    }
    @Test public void quota403IsTransientButPermission403NeedsReconnect() {
        GmailClient.Failure quota=GmailClient.httpFailure(403,json(
            "{\"error\":{\"errors\":[{\"reason\":\"userRateLimitExceeded\"}]}}"),2);
        assertEquals(429,quota.status);
        assertFalse(quota.requiresReconnect());
        assertTrue(GmailClient.httpFailure(403,json(
            "{\"error\":{\"errors\":[{\"reason\":\"insufficientPermissions\"}]}}"),0).requiresReconnect());
    }
    @Test public void missingAndAttachmentOnlyBodiesFailWithoutReturningCheckpoint() throws Exception {
        for (JSONObject payload : List.of(json("{}"), json("{\"mimeType\":\"multipart/mixed\",\"parts\":["
                +"{\"mimeType\":\"application/pdf\",\"filename\":\"document.pdf\",\"body\":{\"attachmentId\":\"binary\"}}]}"),
                json("{\"mimeType\":\"text/plain\",\"body\":{}}"))) {
            JSONObject m=message("a","[]").put("payload",payload);
            Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
                .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
                .at("/messages/a?format=full",m);
            try { new GmailClient(f).scan("one",null); fail("Empty MIME content was scored"); }
            catch (GmailClient.Failure e) { assertEquals(422,e.status); }
        }
    }
    @Test public void attachmentDispositionWinsEvenWithoutFilenameAndIsNotFetched() throws Exception {
        JSONObject payload=json("{\"mimeType\":\"multipart/alternative\",\"parts\":["
            +"{\"mimeType\":\"text/html\",\"body\":{\"data\":\"PHA-SGk8L3A-\"}},"
            +"{\"mimeType\":\"text/plain\",\"headers\":[{\"name\":\"content-disposition\",\"value\":\" ATTACHMENT; name=document.txt\"}],"
            +"\"body\":{\"attachmentId\":\"must-not-fetch\",\"data\":\"c2VjcmV0\"}}]}");
        assertEquals("Hi",GmailClient.mimeText(payload));
        JSONObject m=message("a","[]").put("payload",payload);
        Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
            .at("/messages/a?format=full",m);
        assertEquals("Hi",new GmailClient(f).scan("one",null).samples().getJSONObject(0).getString("body"));
    }
    @Test public void missingTextAttachmentDataFailsExplicitly() throws Exception {
        for (Object response : List.of(json("{}"),new GmailClient.Failure(404,0))) {
            JSONObject m=message("a","[]").put("payload",json("{\"mimeType\":\"text/plain\",\"body\":{\"attachmentId\":\"text\"}}"));
            Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
                .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
                .at("/messages/a?format=full",m)
                .at("/messages/a/attachments/text",response);
            try { new GmailClient(f).scan("one",null); fail("Missing attachment text was scored"); }
            catch (GmailClient.Failure e) { assertEquals(422,e.status); }
        }
    }
    @Test public void spoofedFromDoesNotTurnReceivedMailIntoSent() throws Exception {
        JSONObject m=message("external","[\"INBOX\"]");
        m.getJSONObject("payload").put("headers",new JSONArray().put(new JSONObject()
            .put("name","From").put("value","Known Account <synthetic@example.invalid>")));
        assertEquals("received",GmailClient.sample("hashed-known-account",m).getString("direction"));
        m.put("labelIds",new JSONArray().put("SENT"));
        assertEquals("sent",GmailClient.sample("hashed-known-account",m).getString("direction"));
    }
    @Test public void preferredPlainAvoidsFetchingUnusedHtmlAttachment() throws Exception {
        JSONObject m=message("a","[]").put("payload",json("{\"mimeType\":\"multipart/alternative\",\"parts\":["
            +"{\"mimeType\":\"text/html\",\"body\":{\"attachmentId\":\"unused-html\"}},"
            +"{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"SGVsbG8\"}}]}"));
        Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
            .at("/messages/a?format=full",m);
        assertEquals("Hello",new GmailClient(f).scan("one",null).samples().getJSONObject(0).getString("body"));
    }
}
