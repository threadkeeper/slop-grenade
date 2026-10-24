package com.threadkeeper.slopgrenade.gmail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class GmailClientTest {
    @Test public void batchNeedsNoJavaRecordRuntimeAndDoesNotExposeContentInToString() {
        JSONArray samples=new JSONArray().put(new JSONObject().put("body","synthetic-private-body"));
        GmailClient.Batch batch=new GmailClient.Batch(samples,"42",true);
        assertEquals(Object.class,GmailClient.Batch.class.getSuperclass());
        assertSame(samples,batch.samples());
        assertEquals("42",batch.historyId());
        assertTrue(batch.resynced());
        assertFalse(batch.toString().contains("synthetic-private-body"));
    }
    private static JSONObject json(String value) { return new JSONObject(value); }
    private static JSONObject message(String id, String labels) {
        return json("{\"id\":\""+id+"\",\"labelIds\":"+labels+",\"internalDate\":\""+(System.currentTimeMillis()-1000)+"\","
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
            if (queue == null && path.startsWith(GmailClient.FULL)) {
                int paging=path.indexOf("&pageToken=");
                queue=responses.get(GmailClient.FULL+(paging < 0 ? "" : path.substring(paging)));
            }
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
    @Test public void mimePrefersPlainAndSkipsAttachments() throws Exception {
        JSONObject payload=json("{\"mimeType\":\"multipart/mixed\",\"parts\":["
            +"{\"mimeType\":\"multipart/alternative\",\"parts\":["
            +"{\"mimeType\":\"text/html\",\"body\":{\"data\":\"PGI-SGk8L2I-\"}},"
            +"{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"SGk\"}}]},"
            +"{\"mimeType\":\"text/plain\",\"filename\":\"private.txt\",\"body\":{\"data\":\"c2VjcmV0\"}}]}");
        assertEquals("Hi", GmailClient.mimeText(payload));
    }
    @Test public void htmlFallbackMalformedAndAccountIsolation() throws Exception {
        assertEquals("Hello & bye",GmailClient.mimeText(json("{\"mimeType\":\"text/html\",\"body\":{\"data\":\"PHA-SGVsbG8gJmFtcDsgYnllPC9wPg\"}}")));
        try { GmailClient.mimeText(json("{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"!\"}}")); fail(); }
        catch (GmailClient.Failure e) { assertEquals(422,e.status); }
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
    @Test public void honorsDeclaredCharsetAndStripsExecutableHtml() throws Exception {
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
    @Test public void emptyAndAttachmentOnlyBodiesReturnSamplesAndCheckpoint() throws Exception {
        for (JSONObject payload : List.of(json("{}"), json("{\"mimeType\":\"multipart/mixed\",\"parts\":["
                +"{\"mimeType\":\"application/pdf\",\"filename\":\"document.pdf\",\"body\":{\"attachmentId\":\"binary\"}}]}"),
                json("{\"mimeType\":\"text/plain\",\"body\":{}}"),
                json("{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"\"}}"),
                json("{\"mimeType\":\"text/html\",\"body\":{\"data\":\"PHA-PC9wPg\"}}"))) {
            JSONObject m=message("a","[]").put("payload",payload);
            Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
                .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
                .at("/messages/a?format=full",m);
            GmailClient.Batch batch=new GmailClient(f).scan("one",null);
            assertEquals("10",batch.historyId());
            assertEquals(1,batch.samples().length());
            assertEquals("",batch.samples().getJSONObject(0).getString("body"));
            assertEquals("one:a",batch.samples().getJSONObject(0).getString("messageId"));
        }
    }
    @Test public void emptyInlineTextAttachmentIsValidWhenDataIsPresent() throws Exception {
        JSONObject m=message("a","[]").put("payload",json("{\"mimeType\":\"text/plain\",\"body\":{\"attachmentId\":\"text\"}}"));
        Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
            .at("/messages/a?format=full",m)
            .at("/messages/a/attachments/text",json("{\"data\":\"\"}"));
        GmailClient.Batch batch=new GmailClient(f).scan("one",null);
        assertEquals("10",batch.historyId());
        assertEquals("",batch.samples().getJSONObject(0).getString("body"));
    }
    @Test public void emptyMailDoesNotBlockNormalHistoryFollowupAndIdsStayAccountScoped() throws Exception {
        JSONObject empty=message("empty","[]").put("payload",json("{\"mimeType\":\"multipart/mixed\",\"parts\":["
            +"{\"mimeType\":\"application/pdf\",\"filename\":\"fixture.pdf\",\"body\":{\"attachmentId\":\"binary\"}}]}"));
        JSONObject history=json("{\"historyId\":\"11\",\"history\":[{\"messagesAdded\":["
            +"{\"message\":{\"id\":\"empty\"}},{\"message\":{\"id\":\"normal\"}}],"
            +"\"labelsAdded\":[{\"message\":{\"id\":\"empty\"}}]}]}");
        Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"empty\"}]}"))
            .at("/messages/empty?format=full",empty,empty,empty)
            .at("/messages/normal?format=full",message("normal","[]"),message("normal","[]"))
            .at("/history?startHistoryId=10&maxResults=500",history,history);
        GmailClient client=new GmailClient(f);
        GmailClient.Batch first=client.scan("one",null);
        GmailClient.Batch next=client.scan("one",first.historyId());
        GmailClient.Batch other=client.scan("two","10");
        assertEquals("11",next.historyId());
        assertEquals(2,next.samples().length());
        assertEquals("one:empty",next.samples().getJSONObject(0).getString("messageId"));
        assertEquals("",next.samples().getJSONObject(0).getString("body"));
        assertEquals("Hello",next.samples().getJSONObject(1).getString("body"));
        assertEquals("two:empty",other.samples().getJSONObject(0).getString("messageId"));
        assertEquals(3,Collections.frequency(f.calls,"/messages/empty?format=full"));
    }
    @Test public void malformedTimestampStillFailsForEmptyMail() throws Exception {
        for (String timestamp : List.of("", "not-a-timestamp", "9223372036854775808")) {
            Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
                .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
                .at("/messages/a?format=full",message("a","[]").put("internalDate",timestamp)
                    .put("payload",json("{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"\"}}")));
            try { new GmailClient(f).scan("one",null); fail("Invalid timestamp was scored"); }
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
        for (Object response : List.of(json("{}"),json("{\"data\":null}"),json("{\"data\":42}"),
                new GmailClient.Failure(404,0))) {
            JSONObject m=message("a","[]").put("payload",json("{\"mimeType\":\"text/plain\",\"body\":{\"attachmentId\":\"text\"}}"));
            Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
                .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
                .at("/messages/a?format=full",m)
                .at("/messages/a/attachments/text",response);
            try { new GmailClient(f).scan("one",null); fail("Missing attachment text was scored"); }
            catch (GmailClient.Failure e) { assertEquals(422,e.status); }
        }
    }
    @Test public void unresolvedInlineTextAttachmentCannotMasqueradeAsEmptyBody() throws Exception {
        try {
            GmailClient.sample("one",message("a","[]").put("payload",
                json("{\"mimeType\":\"text/plain\",\"body\":{\"attachmentId\":\"unresolved\"}}")));
            fail("Unresolved inline text was scored");
        } catch (GmailClient.Failure e) { assertEquals(422,e.status); }
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
    @Test public void capturesFixedEpochWindowOnceAcrossPagesAndFiltersExactMilliseconds() throws Exception {
        long end=1_700_604_800_999L, start=end-7L*24*60*60*1000;
        int[] clockReads={0};
        java.time.Clock clock=new java.time.Clock() {
            public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
            public java.time.Clock withZone(java.time.ZoneId ignored) { return this; }
            public java.time.Instant instant() { return java.time.Instant.ofEpochMilli(end+clockReads[0]++*86400000L); }
        };
        Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
            .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"start\"},{\"id\":\"inside\"}],\"nextPageToken\":\"p\"}"))
            .at(GmailClient.FULL+"&pageToken=p",json("{\"messages\":[{\"id\":\"end\"},{\"id\":\"future\"}]}"))
            .at("/messages/start?format=full",message("start","[]").put("internalDate",Long.toString(start)))
            .at("/messages/inside?format=full",message("inside","[]").put("internalDate",Long.toString(start+1)))
            .at("/messages/end?format=full",message("end","[]").put("internalDate",Long.toString(end)))
            .at("/messages/future?format=full",message("future","[]").put("internalDate",Long.toString(end+1)));
        GmailClient.Batch batch=new GmailClient(f,ignored -> {},clock).scan("one",null);
        assertEquals(1,clockReads[0]);
        assertEquals(2,batch.samples().length());
        assertEquals("one:inside",batch.samples().getJSONObject(0).getString("messageId"));
        assertEquals("one:end",batch.samples().getJSONObject(1).getString("messageId"));
        assertEquals("/profile",f.calls.get(0));
        String query=java.net.URLDecoder.decode(f.calls.get(1).substring(GmailClient.FULL.length()),"UTF-8");
        assertTrue(query.contains("after:"+(Math.floorDiv(start,1000)-1)));
        assertTrue(query.contains("before:"+(Math.floorDiv(end,1000)+1)));
        assertFalse(query.contains("newer_than"));
        assertEquals(f.calls.get(1)+"&pageToken=p",f.calls.get(2));
    }
    @Test public void oldUnreadAndSentHistoryDoNotScoreOrFetchOldMimeAttachments() throws Exception {
        long end=1_700_604_800_999L, start=end-7L*24*60*60*1000;
        Fake f=new Fake().at("/history?startHistoryId=10&maxResults=500",json("{\"historyId\":\"11\",\"history\":["
            +"{\"labelsRemoved\":[{\"message\":{\"id\":\"old\"},\"labelIds\":[\"UNREAD\"]}],"
            +"\"labelsAdded\":[{\"message\":{\"id\":\"old-sent\"},\"labelIds\":[\"SENT\"]}]},"
            +"{\"messagesAdded\":[{\"message\":{\"id\":\"recent\"}}]}]}"))
            .at("/messages/old?format=full",message("old","[]").put("internalDate",Long.toString(start-3650L*86400000L))
                .put("payload",json("{\"mimeType\":\"text/plain\",\"body\":{\"attachmentId\":\"must-not-fetch\"}}")))
            .at("/messages/old-sent?format=full",message("old-sent","[\"SENT\"]").put("internalDate",Long.toString(start-1)))
            .at("/messages/recent?format=full",message("recent","[]").put("internalDate",Long.toString(end)));
        GmailClient.Batch batch=new GmailClient(f,ignored -> {},java.time.Clock.fixed(
            java.time.Instant.ofEpochMilli(end),java.time.ZoneOffset.UTC)).scan("one","10");
        assertEquals("11",batch.historyId());
        assertEquals(1,batch.samples().length());
        assertEquals("one:recent",batch.samples().getJSONObject(0).getString("messageId"));
    }
    @Test public void malformedBase64InvalidUtf8AndUnknownCharsetNeverProduceSamples() throws Exception {
        for (String payload : List.of(
            "{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"!\"}}",
            "{\"mimeType\":\"text/plain\",\"body\":{\"data\":\"_w\"}}",
            "{\"mimeType\":\"text/plain\",\"headers\":[{\"name\":\"Content-Type\",\"value\":\"text/plain; charset=not-a-real-charset\"}],\"body\":{\"data\":\"SGVsbG8\"}}")) {
            Fake f=new Fake().at("/profile",json("{\"historyId\":\"10\"}"))
                .at(GmailClient.FULL,json("{\"messages\":[{\"id\":\"a\"}]}"))
                .at("/messages/a?format=full",message("a","[]").put("payload",json(payload)));
            try { new GmailClient(f).scan("one",null); fail("Invalid MIME was scored"); }
            catch (GmailClient.Failure e) { assertEquals(422,e.status); }
        }
    }
    @Test public void historyArrivingAfterFixedEndIsDeferredWithoutLosingCursor() throws Exception {
        long end=1_700_604_800_999L;
        int[] reads={0};
        java.time.Clock clock=new java.time.Clock() {
            public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
            public java.time.Clock withZone(java.time.ZoneId ignored) { return this; }
            public java.time.Instant instant() { return java.time.Instant.ofEpochMilli(end+reads[0]++*1000L); }
        };
        JSONObject history=json("{\"historyId\":\"11\",\"history\":[{\"messagesAdded\":[{\"message\":{\"id\":\"new\"}}]}]}");
        JSONObject mail=message("new","[]").put("internalDate",Long.toString(end+1));
        Fake f=new Fake().at("/history?startHistoryId=10&maxResults=500",history,history)
            .at("/messages/new?format=full",mail,mail);
        GmailClient client=new GmailClient(f,ignored -> {},clock);
        GmailClient.Batch first=client.scan("one","10");
        assertEquals("10",first.historyId());
        assertEquals(0,first.samples().length());
        GmailClient.Batch second=client.scan("one",first.historyId());
        assertEquals("11",second.historyId());
        assertEquals(1,second.samples().length());
        assertEquals(2,reads[0]);
    }
}
