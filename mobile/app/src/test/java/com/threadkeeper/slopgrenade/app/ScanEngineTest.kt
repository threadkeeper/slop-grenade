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
            "/internal/ingest" -> if (failIngest) """{"status":503,"body":{}}""" else """{"status":200,"body":{"ok":true}}"""
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
    @Test fun disconnectWaitsForInFlightIngestThenPurgesWithoutResurrection() {
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
}
