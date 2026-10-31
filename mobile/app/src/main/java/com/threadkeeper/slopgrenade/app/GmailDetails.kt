package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.AccountRepository
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.accounts.AuthorizationRequired
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONArray
import org.json.JSONObject

/** Fetches view-only Gmail details without storing them in the core ledger or event bus. */
class GmailDetails(
    private val accounts: AccountRepository,
    private val core: CoreApi,
    private val token: (AccountState) -> String,
    private val fetch: (String, String) -> JSONObject,
    private val visible: () -> Boolean,
    private val visibilityEpoch: () -> Long = { 0L },
) {
    class InvalidRequest : Exception()
    class Stale : Exception()

    private data class Snapshot(val session: String, val generation: Long, val ids: Set<String>)

    /** Only current Gmail ledger IDs may be fetched, in small, foreground-only batches. */
    fun load(body: JSONObject): JSONObject {
        val values = body.opt("messageIds") as? JSONArray ?: throw InvalidRequest()
        if (body.length() != 1 || values.length() !in 1..10) throw InvalidRequest()
        val ids = (0 until values.length()).map {
            val id = values.opt(it) as? String ?: throw InvalidRequest()
            if (!ID.matches(id)) throw InvalidRequest()
            id
        }
        if (ids.toSet().size != ids.size) throw InvalidRequest()
        if (!visible()) throw Stale()
        val foregroundEpoch = visibilityEpoch()
        if (!visible()) throw Stale()
        val before = snapshot()
        if (!before.ids.containsAll(ids)) throw InvalidRequest()
        val accountMap = accounts.all().associateBy { it.id }
        if (ids.any { it.substringBefore(':') !in accountMap }) throw InvalidRequest()

        val tokens = mutableMapOf<String, String>()
        val failedAccounts = mutableMapOf<String, String>()
        val entries = JSONArray()
        for (id in ids) {
            if (!visible() || visibilityEpoch() != foregroundEpoch || Thread.currentThread().isInterrupted) throw Stale()
            val accountId = id.substringBefore(':')
            val account = accountMap.getValue(accountId)
            if (account.label.codePointCount(0, account.label.length) > 1024)
                throw IllegalStateException("Invalid Gmail account label")
            var failure = failedAccounts[accountId]
            var detail: JSONObject? = null
            if (failure == null && account.reconnectRequired) failure = "reconnect"
            if (failure == null) {
                try {
                    val accessToken = tokens[accountId] ?: token(account).also { tokens[accountId] = it }
                    detail = fetch(accessToken, id.substringAfter(':'))
                } catch (_: AuthorizationRequired) {
                    failure = "reconnect"
                } catch (error: GmailClient.Failure) {
                    failure = when (error.status) {
                        404 -> "not_found"
                        401, 403 -> "reconnect"
                        else -> "unavailable"
                    }
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw Stale()
                }
            }
            val entry = JSONObject().put("messageId", id).put("mailbox", account.label)
            if (failure != null) {
                if (failure != "not_found") failedAccounts[accountId] = failure
                entry.put("error", failure)
            } else {
                val value = detail ?: throw IllegalStateException("Gmail details unavailable")
                for (field in FIELDS) {
                    val text = value.opt(field) as? String ?: throw IllegalStateException("Invalid Gmail details")
                    val limit = if (field == "excerpt") 160 else 1024
                    if (text.codePointCount(0, text.length) > limit) throw IllegalStateException("Invalid Gmail details")
                    entry.put(field, text)
                }
            }
            entries.put(entry)
        }
        if (!visible() || visibilityEpoch() != foregroundEpoch) throw Stale()
        val after = snapshot()
        val remaining = accounts.all().map { it.id }.toSet()
        if (!visible() || visibilityEpoch() != foregroundEpoch ||
            before.session != after.session || before.generation != after.generation ||
            !after.ids.containsAll(ids) || ids.any { it.substringBefore(':') !in remaining }) throw Stale()
        return JSONObject().put("entries", entries)
    }

    private fun snapshot(): Snapshot {
        val session = core.checked("GET", "/internal/session") as JSONObject
        val ledger = core.checked("GET", "/api/v1/ledger") as JSONObject
        val reports = ledger.getJSONArray("recentReports")
        val ids = (0 until reports.length()).mapNotNull {
            val report = reports.optJSONObject(it) ?: return@mapNotNull null
            if (report.optString("app") == "gmail") report.optString("messageId").takeIf(ID::matches) else null
        }.toSet()
        return Snapshot(session.getString("sessionId"), ledger.getLong("resetGeneration"), ids)
    }

    companion object {
        private val ID = Regex("""[a-f0-9]{64}:[A-Za-z0-9_-]{1,128}""")
        private val FIELDS = listOf("sender", "recipient", "subject", "excerpt")
    }
}
