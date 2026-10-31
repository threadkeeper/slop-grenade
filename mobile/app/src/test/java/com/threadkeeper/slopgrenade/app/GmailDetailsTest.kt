package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.AccountRepository
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.accounts.AuthorizationRequired
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GmailDetailsTest {
    private val first = AccountState(AccountState.identity("one@example.invalid"), "one@example.invalid")
    private val second = AccountState(AccountState.identity("two@example.invalid"), "two@example.invalid")
    private val firstId = "${first.id}:message-1"
    private val secondId = "${second.id}:message-2"
    private val thirdId = "${first.id}:message-3"

    private class Store(vararg accounts: AccountState) : AccountRepository {
        private val values = accounts.associateBy { it.id }.toMutableMap()
        override fun all() = values.values.toList()
        override fun put(account: AccountState) { values[account.id] = account }
        override fun remove(id: String) { values.remove(id) }
    }

    private fun body(vararg ids: String) = JSONObject().put("messageIds", JSONArray(ids.toList()))
    private fun detail(sender: String) = JSONObject().put("sender", sender)
        .put("recipient", "receiver@example.invalid").put("subject", "Synthetic subject")
        .put("excerpt", "Synthetic excerpt")

    @Test fun fetchesOnlyCurrentLedgerEntriesForTheirOwnAccounts() {
        val store = Store(first, second)
        val calls = mutableListOf<String>()
        val tokens = mutableListOf<String>()
        val core = core { 0 }
        val service = GmailDetails(store, core, { account -> tokens.add(account.id); account.id },
            { token, message -> calls.add("$token:$message"); detail("sender@example.invalid") }, { true })
        val result = service.load(body(firstId, secondId)).getJSONArray("entries")
        assertEquals(2, result.length())
        assertEquals(firstId, result.getJSONObject(0).getString("messageId"))
        assertEquals(first.label, result.getJSONObject(0).getString("mailbox"))
        assertEquals(second.label, result.getJSONObject(1).getString("mailbox"))
        assertEquals("sender@example.invalid", result.getJSONObject(0).getString("sender"))
        assertEquals(setOf(first.id, second.id), tokens.toSet())
        assertEquals(listOf(firstId, secondId), calls)
    }

    @Test fun rejectsUnknownInvalidOrOversizedRequestsBeforeFetching() {
        val service = GmailDetails(Store(first), core { 0 }, { fail("Unexpected token"); "" },
            { _, _ -> fail("Unexpected fetch"); JSONObject() }, { true })
        for (request in listOf(
            body("${first.id}:unknown"), body("${first.id}:../bad"), body(firstId, firstId),
            body(*(0..10).map { "${first.id}:id-$it" }.toTypedArray()),
            body(firstId).put("extra", "not allowed")
        )) {
            try { service.load(request); fail("Invalid request accepted") }
            catch (_: GmailDetails.InvalidRequest) { }
        }
    }

    @Test fun reusesOneTransientTokenForMessagesFromTheSameAccount() {
        var tokens = 0
        val service = GmailDetails(Store(first), core { 0 }, { tokens++; "ephemeral" },
            { _, _ -> detail("sender@example.invalid") }, { true })
        assertEquals(2, service.load(body(firstId, thirdId)).getJSONArray("entries").length())
        assertEquals(1, tokens)
    }

    @Test fun neverReturnsUnrequestedBodyOrRawProviderFields() {
        val service = GmailDetails(Store(first), core { 0 }, { "ephemeral" }, { _, _ ->
            detail("sender@example.invalid").put("body", "synthetic-private-body")
                .put("providerHeaders", "synthetic-private-headers")
        }, { true })
        val response = service.load(body(firstId)).toString()
        assertTrue(response.contains("Synthetic excerpt"))
        assertFalse(response.contains("synthetic-private-body"))
        assertFalse(response.contains("synthetic-private-headers"))
    }

    @Test fun isolatesAccountFailuresAndNeverReturnsProviderExceptionText() {
        val service = GmailDetails(Store(first, second), core { 0 },
            { if (it.id == first.id) throw AuthorizationRequired() else it.id },
            { _, _ -> detail("second-sender@example.invalid") }, { true })
        val entries = service.load(body(firstId, secondId)).getJSONArray("entries")
        assertEquals("reconnect", entries.getJSONObject(0).getString("error"))
        assertEquals(first.label, entries.getJSONObject(0).getString("mailbox"))
        assertEquals("second-sender@example.invalid", entries.getJSONObject(1).getString("sender"))
        assertFalse(entries.toString().contains("synthetic-token"))
    }

    @Test fun discardsFetchedDetailsAfterWipeOrWhenTheAppLeavesForeground() {
        var epoch = 0
        var visible = true
        val service = GmailDetails(Store(first), core { epoch }, { "ephemeral" }, { _, _ ->
            epoch++
            detail("sender@example.invalid")
        }, { visible })
        try { service.load(body(firstId)); fail("Stale details escaped") }
        catch (_: GmailDetails.Stale) { }
        visible = false
        try { service.load(body(firstId)); fail("Background details escaped") }
        catch (_: GmailDetails.Stale) { }
    }

    @Test fun discardsDetailsIfTheAppLeavesAndReturnsDuringTheFetch() {
        var foregroundEpoch = 0L
        val service = GmailDetails(Store(first), core { 0 }, { "ephemeral" }, { _, _ ->
            foregroundEpoch += 2
            detail("sender@example.invalid")
        }, { true }, { foregroundEpoch })
        try { service.load(body(firstId)); fail("Previous-view details escaped") }
        catch (_: GmailDetails.Stale) { }
    }

    @Test fun discardsDetailsIfTheAccountIsRemovedDuringTheFetch() {
        val store = Store(first)
        val service = GmailDetails(store, core { 0 }, { "ephemeral" }, { _, _ ->
            store.remove(first.id)
            detail("sender@example.invalid")
        }, { true })
        try { service.load(body(firstId)); fail("Disconnected account details escaped") }
        catch (_: GmailDetails.Stale) { }
    }

    @Test fun messageFailuresAreExplicitAndDoNotLeakProviderData() {
        val service = GmailDetails(Store(first), core { 0 }, { "ephemeral" },
            { _, _ -> throw GmailClient.Failure(404, 0) }, { true })
        val result = service.load(body(firstId)).getJSONArray("entries").getJSONObject(0)
        assertEquals("not_found", result.getString("error"))
        assertFalse(result.has("sender"))
    }

    private fun core(epoch: () -> Int) = CoreApi { request ->
        when (JSONObject(request).getString("path")) {
            "/internal/session" -> """{"status":200,"body":{"sessionId":"session"}}"""
            "/api/v1/ledger" -> JSONObject().put("status", 200).put("body", JSONObject()
                .put("resetGeneration", epoch()).put("recentReports", JSONArray()
                    .put(JSONObject().put("messageId", firstId).put("app", "gmail"))
                    .put(JSONObject().put("messageId", secondId).put("app", "gmail"))
                    .put(JSONObject().put("messageId", thirdId).put("app", "gmail")))).toString()
            else -> error("Unexpected native route")
        }
    }
}
