package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.*
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class ScanEngineTest {
    private class Store(vararg accounts: AccountState) : AccountRepository {
        private val values = accounts.associateBy { it.id }.toMutableMap()
        override fun all() = values.values.toList()
        override fun put(account: AccountState) { values[account.id] = account }
        override fun remove(id: String) { values.remove(id) }
    }
    private val account = AccountState("one", "synthetic@example.invalid", "9", "old")
    private fun api(calls: MutableList<JSONObject>, failIngest: Boolean = false) = CoreApi {
        val request = JSONObject(it); calls.add(request)
        when (request.getString("path")) {
            "/internal/session" -> """{"status":200,"body":{"sessionId":"new"}}"""
            "/internal/ingest" -> if (failIngest) """{"status":503,"body":{}}""" else
                """{"status":200,"body":{"ok":true,"batch":{"fetchedCount":0,"newMessagesAnalyzed":0,"grenadesTriggered":0}}}"""
            "/internal/disconnect" -> """{"status":200,"body":{"ok":true,"historyRetained":true,"clearedEvents":0}}"""
            else -> """{"status":200,"body":{"ok":true}}"""
        }
    }
    @Test fun newCoreSessionForcesQuietFullRefreshThenIncremental() {
        val store = Store(account)
        val checkpoints = mutableListOf<String?>()
        val calls = mutableListOf<JSONObject>()
        val engine = ScanEngine(store, api(calls), { "ephemeral" }, { _, _, cp ->
            checkpoints.add(cp); GmailClient.Batch(JSONArray(), "10", cp == null)
        })
        assertFalse(engine.scanAll())
        assertNull(checkpoints[0])
        assertTrue(calls[1].getJSONObject("body").getBoolean("quiet"))
        engine.scanAll()
        assertEquals("10", checkpoints[1])
        assertFalse(calls.last().getJSONObject("body").getBoolean("quiet"))
        assertEquals("new", store.all().single().session)
    }
    @Test fun failedIngestNeverAdvancesCheckpoint() {
        val store = Store(account)
        val engine = ScanEngine(store, api(mutableListOf(), true), { "token" }, { _, _, _ ->
            GmailClient.Batch(JSONArray(), "10", true)
        })
        assertTrue(engine.scanAll())
        assertEquals("9", store.all().single().checkpoint)
    }
    @Test fun accountFailureIsIsolatedAndReconnectVisible() {
        val store = Store(account, account.copy(id = "two", label = "other@example.invalid"))
        val engine = ScanEngine(store, api(mutableListOf()), { if (it.id == "one") throw GmailClient.Failure(401, 0) else "token" },
            { _, _, _ -> GmailClient.Batch(JSONArray(), "10", true) })
        assertFalse(engine.scanAll())
        assertTrue(store.all().first { it.id == "one" }.reconnectRequired)
        assertEquals("10", store.all().first { it.id == "two" }.checkpoint)
    }
    @Test fun disconnectWaitsForInFlightIngestThenRemovesConnectionWithoutResurrection() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = mutableListOf<JSONObject>()
        val store = Store(account)
        val engine = ScanEngine(store, api(calls), { "token" }, { _, _, _ ->
            entered.countDown(); check(release.await(3, TimeUnit.SECONDS))
            GmailClient.Batch(JSONArray(), "10", true)
        })
        val scan = thread { engine.scanAll() }
        assertTrue(entered.await(3, TimeUnit.SECONDS))
        val remove = thread { engine.disconnect("one") }
        release.countDown(); scan.join(); remove.join()
        assertTrue(store.all().isEmpty())
        assertEquals("/internal/disconnect", calls.last().getString("path"))
        engine.scanAll()
        assertTrue(store.all().isEmpty())
    }
    @Test fun historyResyncIsQuietEvenInSameSession() {
        val calls = mutableListOf<JSONObject>()
        val engine = ScanEngine(Store(account.copy(session = "new")), api(calls), { "token" },
            { _, _, _ -> GmailClient.Batch(JSONArray(), "11", true) })
        engine.scanAll()
        assertTrue(calls.last().getJSONObject("body").getBoolean("quiet"))
    }
    @Test fun cancellationBeforeIngestDoesNotAdvanceOrPublish() {
        val calls = mutableListOf<JSONObject>()
        val store = Store(account)
        val engine = ScanEngine(store, api(calls), { "token" }, { _, _, _ ->
            Thread.currentThread().interrupt()
            GmailClient.Batch(JSONArray(), "11", true)
        })
        try {
            engine.scanAll()
            fail("Cancellation ignored")
        } catch (_: InterruptedException) {
            assertEquals("9", store.all().single().checkpoint)
            assertEquals(1, calls.size)
        } finally { Thread.interrupted() }
    }
    @Test fun missingMimeContentLeavesCheckpointAndShowsIncompleteStatus() {
        val store = Store(account)
        val calls = mutableListOf<JSONObject>()
        val engine = ScanEngine(store, api(calls), { "token" }, { _, _, _ -> throw GmailClient.Failure(422, 0) })
        assertTrue(engine.scanAll())
        assertEquals("9", store.all().single().checkpoint)
        assertEquals(1, calls.size)
        assertTrue(engine.status.contains("MIME body unavailable"))
        assertTrue(engine.status.contains("checkpoint unchanged"))
    }
    @Test fun explicitRefreshForcesFullQuietSevenDaysAndAggregatesDesktopEnvelope() {
        val store = Store(account.copy(session = "new"), account.copy(id = "two", session = "new"))
        val checkpoints = mutableListOf<String?>()
        var ingests = 0
        val core = CoreApi {
            val request = JSONObject(it)
            if (request.getString("path") == "/internal/session") """{"status":200,"body":{"sessionId":"new"}}"""
            else {
                assertTrue(request.getJSONObject("body").getBoolean("quiet"))
                ingests++
                """{"status":200,"body":{"ok":true,"batch":{"fetchedCount":${if (ingests == 1) 2 else 1},"newMessagesAnalyzed":1,"grenadesTriggered":0}}}"""
            }
        }
        val engine = ScanEngine(store, core, { "token" }, { a, _, checkpoint ->
            checkpoints.add(checkpoint)
            val samples = JSONArray().put(JSONObject())
            if (a.id == "one") samples.put(JSONObject())
            GmailClient.Batch(samples, "20", false)
        })
        val result = engine.refreshAllSevenDays()
        assertTrue(result.ok)
        assertFalse(result.retry)
        assertEquals(listOf(null, null), checkpoints)
        val body = result.toJson()
        assertTrue(body.getBoolean("ok"))
        assertEquals(7, body.getInt("lookbackDays"))
        assertEquals(3, body.getJSONObject("batch").getInt("fetchedCount"))
        assertEquals(2, body.getJSONObject("batch").getInt("newMessagesAnalyzed"))
        assertEquals(0, body.getJSONObject("batch").getInt("grenadesTriggered"))
        assertTrue(store.all().all { it.checkpoint == "20" && it.session == "new" })
    }
    @Test fun refreshFailureKeepsFailedAccountCheckpointButCommitsOtherAccount() {
        val store = Store(account.copy(session = "new"), account.copy(id = "two", session = "new"))
        val engine = ScanEngine(store, api(mutableListOf()), { "token" }, { a, _, checkpoint ->
            assertNull(checkpoint)
            if (a.id == "one") throw GmailClient.Failure(503, 0)
            GmailClient.Batch(JSONArray(), "20", true)
        })
        val result = engine.refreshAllSevenDays()
        assertFalse(result.ok)
        assertTrue(result.retry)
        assertFalse(result.toJson().getBoolean("ok"))
        assertEquals("9", store.all().first { it.id == "one" }.checkpoint)
        assertEquals("20", store.all().first { it.id == "two" }.checkpoint)
    }
    @Test fun typedAuthorizationFailureMarksReconnectWithoutRetryLoop() {
        val store = Store(account)
        val engine = ScanEngine(store, api(mutableListOf()), { throw AuthorizationRequired() },
            { _, _, _ -> error("Unauthorized account must not fetch mail") })
        val result = engine.refreshAllSevenDays()
        assertFalse(result.ok)
        assertFalse(result.retry)
        assertTrue(store.all().single().reconnectRequired)
        assertEquals("9", store.all().single().checkpoint)
        assertTrue(engine.status.contains("Reconnect required"))
        assertFalse(engine.scanAll())
    }
    @Test fun everyIngestPathPreservesTransientMetadataForNativeScoringAndGrouping() {
        val inputs = mutableListOf<JSONObject>()
        val core = CoreApi {
            val request = JSONObject(it)
            if (request.getString("path") == "/internal/session") """{"status":200,"body":{"sessionId":"new"}}"""
            else {
                val sample = request.getJSONObject("body").getJSONArray("samples").getJSONObject(0)
                assertEquals("noreply@example.invalid", sample.getString("sender"))
                assertEquals("Automatic reply: Synthetic private topic", sample.getString("subjectOrTopic"))
                assertEquals("Ephemeral synthetic body", sample.getString("body"))
                inputs.add(request.getJSONObject("body"))
                """{"status":200,"body":{"ok":true,"batch":{"fetchedCount":1,"newMessagesAnalyzed":1,"grenadesTriggered":0}}}"""
            }
        }
        val engine = ScanEngine(Store(account), core, { "token" }, { _, _, _ ->
            GmailClient.Batch(JSONArray().put(JSONObject().put("sender", "noreply@example.invalid")
                .put("subjectOrTopic", "Automatic reply: Synthetic private topic").put("body", "Ephemeral synthetic body")
                .put("direction", "received")), "20", false)
        })
        assertTrue(engine.refreshAllSevenDays().ok)
        assertFalse(engine.scanAll())
        assertEquals(2, inputs.size)
        assertTrue(inputs[0].getBoolean("quiet"))
        assertFalse(inputs[1].getBoolean("quiet"))
    }
    @Test fun realGmailEmptyAndNormalBatchesAdvanceCheckpointsAndKeepAccountsIndependent() {
        val store = Store(account, account.copy(id = "two"))
        val seen = mutableSetOf<String>()
        val inputs = mutableListOf<JSONObject>()
        val core = CoreApi {
            val request = JSONObject(it)
            if (request.getString("path") == "/internal/session") """{"status":200,"body":{"sessionId":"new"}}"""
            else {
                val input = request.getJSONObject("body")
                inputs.add(input)
                val samples = input.getJSONArray("samples")
                var added = 0
                for (i in 0 until samples.length()) {
                    if (seen.add(samples.getJSONObject(i).getString("messageId"))) added++
                }
                """{"status":200,"body":{"ok":true,"batch":{"fetchedCount":${samples.length()},"newMessagesAnalyzed":$added,"grenadesTriggered":0}}}"""
            }
        }
        val client = GmailClient { path ->
            when {
                path == "/profile" -> JSONObject().put("historyId", "10")
                path.startsWith(GmailClient.FULL) ->
                    JSONObject("""{"messages":[{"id":"empty"}]}""")
                path.startsWith("/history?startHistoryId=10") ->
                    JSONObject("""{"historyId":"11","history":[{"messagesAdded":[{"message":{"id":"empty"}},{"message":{"id":"normal"}}],"labelsAdded":[{"message":{"id":"empty"}}]}]}""")
                path.startsWith("/history?startHistoryId=11") -> JSONObject("""{"historyId":"12"}""")
                path.startsWith("/messages/") -> {
                    val empty = path.contains("/empty?")
                    JSONObject().put("id", if (empty) "empty" else "normal")
                        .put("internalDate", (System.currentTimeMillis() - 1000).toString())
                        .put("labelIds", JSONArray().put("INBOX"))
                        .put("payload", JSONObject().put("mimeType", if (empty) "application/pdf" else "text/plain")
                            .put("filename", if (empty) "fixture.pdf" else "")
                            .put("headers", JSONArray()
                                .put(JSONObject().put("name", "From").put("value", "noreply@example.invalid"))
                                .put(JSONObject().put("name", "Subject").put("value", "Automatic reply: fixture")))
                            .put("body", if (empty) JSONObject().put("attachmentId", "not-fetched")
                                else JSONObject().put("data", "SGVsbG8")))
                }
                else -> error("Unexpected synthetic transport path")
            }
        }
        val engine = ScanEngine(store, core, { "ephemeral" }, { a, _, cp -> client.scan(a.id, cp) })
        val first = engine.refreshAllSevenDays()
        assertTrue(first.ok)
        assertEquals(2L, first.newMessagesAnalyzed)
        assertTrue(store.all().all { it.checkpoint == "10" })
        assertFalse(engine.scanAll())
        assertTrue(store.all().all { it.checkpoint == "11" })
        assertEquals(setOf("one:empty", "two:empty", "one:normal", "two:normal"), seen)
        assertFalse(engine.scanAll())
        assertTrue(store.all().all { it.checkpoint == "12" })
        assertEquals(4, seen.size)
        assertEquals(6, inputs.size)
        assertTrue(inputs.take(2).all { it.getBoolean("quiet") })
        assertTrue(inputs.drop(2).all { !it.getBoolean("quiet") })
        val firstSample = inputs[0].getJSONArray("samples").getJSONObject(0)
        assertEquals("", firstSample.getString("body"))
        assertEquals("noreply@example.invalid", firstSample.getString("sender"))
        assertEquals("Automatic reply: fixture", firstSample.getString("subjectOrTopic"))
    }
    @Test fun disconnectForwardsRetentionAcknowledgementAndReconnectUsesSameDedupIdentity() {
        val email = "synthetic@example.invalid"
        val id = AccountState.identity(email)
        val store = Store(AccountState(id, email))
        val seen = mutableSetOf<String>()
        var historicalMessages = 0
        var ingests = 0
        val core = CoreApi {
            val request = JSONObject(it)
            when (request.getString("path")) {
                "/internal/session" -> """{"status":200,"body":{"sessionId":"same-process"}}"""
                "/internal/ingest" -> {
                    val input = request.getJSONObject("body")
                    assertTrue(input.getBoolean("quiet"))
                    val messageId = input.getJSONArray("samples").getJSONObject(0).getString("messageId")
                    assertEquals("$id:gmail-id", messageId)
                    val added = if (seen.add(messageId)) 1 else 0
                    historicalMessages += added
                    ingests++
                    """{"status":200,"body":{"ok":true,"batch":{"fetchedCount":1,"newMessagesAnalyzed":$added,"grenadesTriggered":0}}}"""
                }
                "/internal/disconnect" -> {
                    assertEquals(id, request.getJSONObject("body").getString("accountId"))
                    """{"status":200,"body":{"ok":true,"historyRetained":true,"clearedEvents":0}}"""
                }
                else -> error("Disconnect must not reset native history or deduplication")
            }
        }
        val engine = ScanEngine(store, core, { "token" }, { _, _, checkpoint ->
            assertNull(checkpoint)
            GmailClient.Batch(JSONArray().put(JSONObject().put("messageId", "$id:gmail-id")
                .put("sender", "synthetic@example.invalid").put("subjectOrTopic", "Synthetic topic")
                .put("body", "Synthetic body").put("direction", "received")), "20", true)
        })
        assertEquals(1L, engine.refreshAllSevenDays().newMessagesAnalyzed)
        val disconnected = engine.disconnect(id)
        assertTrue(disconnected.getBoolean("historyRetained"))
        assertEquals(0, disconnected.getInt("clearedEvents"))
        assertTrue(store.all().isEmpty())
        assertEquals(id, engine.connect(email).id)
        assertEquals(0L, engine.refreshAllSevenDays().newMessagesAnalyzed)
        assertEquals(2, ingests)
        assertEquals(1, historicalMessages)
        assertEquals(1, seen.size)
    }
}
