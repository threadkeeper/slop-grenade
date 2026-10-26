package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.AccountRepository
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.accounts.AuthorizationRequired
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONObject
import java.time.Instant

/**
 * Serializes scan/ingest/checkpoint/disconnect transactions in this process.
 * Disconnect waits for an in-flight transaction, clears queued account effects, then removes
 * only the connection/checkpoint. Native historical statistics and seen IDs remain for this
 * process session; reconnecting quietly rehydrates without double-counting the same messages.
 */
class ScanEngine(
    private val accounts: AccountRepository,
    private val core: CoreApi,
    private val token: (AccountState) -> String,
    private val fetch: (AccountState, String, String?) -> GmailClient.Batch,
) {
    @Volatile var status: String = "Not scanned"
        private set

    /** Refresh counts reflect successfully ingested and checkpointed accounts; failures remain isolated. */
    data class RefreshSummary(
        val fetchedCount: Long,
        val newMessagesAnalyzed: Long,
        val grenadesTriggered: Long,
        val retry: Boolean,
        val ok: Boolean,
        val error: String,
    ) {
        fun toJson(): JSONObject = JSONObject().put("ok", ok).put("lookbackDays", 7)
            .put("batch", JSONObject().put("fetchedCount", fetchedCount)
                .put("newMessagesAnalyzed", newMessagesAnalyzed).put("grenadesTriggered", grenadesTriggered))
            .also { if (!ok) it.put("error", error) }
    }

    /** Background poll uses history when the checkpoint belongs to this core session. */
    @Synchronized fun scanAll(): Boolean = scan(forceFull = false).retry

    /** User refresh always fetches a quiet full seven days, regardless of an existing checkpoint. */
    @Synchronized fun refreshAllSevenDays(): RefreshSummary = scan(forceFull = true)

    private fun scan(forceFull: Boolean): RefreshSummary {
        var retry = false
        var missingBody = false
        var incomplete = false
        var reconnect = false
        var fetched = 0L
        var analyzed = 0L
        var grenades = 0L
        val session = (core.checked("GET", "/internal/session") as JSONObject).getString("sessionId")
        for (account in accounts.all()) {
            if (Thread.currentThread().isInterrupted) throw InterruptedException()
            if (account.reconnectRequired) {
                incomplete = true
                reconnect = true
                continue
            }
            try {
                val checkpoint = if (forceFull) null else account.checkpointFor(session)
                val batch = fetch(account, token(account), checkpoint)
                if (Thread.currentThread().isInterrupted) throw InterruptedException()
                val quiet = forceFull || checkpoint == null || batch.resynced()
                // Sender, subject, and body remain transient scoring input. NativeCore sanitizes
                // reports after detection, before ledger storage, events, or response output.
                val ingest = core.checked("POST", "/internal/ingest", JSONObject().put("samples", batch.samples())
                    .put("quiet", quiet)) as JSONObject
                check(ingest.getBoolean("ok")) { "Native ingest failed" }
                val counts = ingest.getJSONObject("batch")
                val accountFetched = counts.getLong("fetchedCount")
                val accountAnalyzed = counts.getLong("newMessagesAnalyzed")
                val accountGrenades = counts.getLong("grenadesTriggered")
                check(accountFetched == batch.samples().length().toLong() &&
                    accountAnalyzed in 0..accountFetched && accountGrenades in 0..accountAnalyzed &&
                    (!quiet || accountGrenades == 0L)) { "Invalid native ingest counts" }
                accounts.put(account.copy(checkpoint = batch.historyId(), session = session,
                    lastSuccessfulScan = Instant.now().toString(), reconnectRequired = false))
                fetched += accountFetched
                analyzed += accountAnalyzed
                grenades += accountGrenades
            } catch (_: AuthorizationRequired) {
                accounts.put(account.copy(reconnectRequired = true))
                incomplete = true
                reconnect = true
            } catch (e: GmailClient.Failure) {
                incomplete = true
                if (e.requiresReconnect()) {
                    accounts.put(account.copy(reconnectRequired = true))
                    reconnect = true
                }
                else {
                    retry = true
                    missingBody = missingBody || e.status == 422
                }
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                throw e
            } catch (_: Exception) {
                incomplete = true
                retry = true
            }
        }
        status = when {
            missingBody -> "Message MIME body unavailable; scan incomplete, checkpoint unchanged for affected accounts"
            retry -> "Temporary failure; retry scheduled"
            reconnect -> "Reconnect required; affected accounts were not refreshed and checkpoints are unchanged"
            else -> "Scan complete; background work is best effort"
        }
        return RefreshSummary(fetched, analyzed, grenades, retry, !incomplete, status)
    }

    @Synchronized fun connect(email: String, reconnectId: String? = null): AccountState {
        val id = AccountState.identity(email)
        require(reconnectId == null || reconnectId == id) { "Selected account does not match" }
        val previous = accounts.all().find { it.id == id }
        check(reconnectId == null || previous != null) { "Account was disconnected" }
        val value = previous?.copy(reconnectRequired = false)
            ?: AccountState(id, email)
        accounts.put(value)
        return value
    }

    @Synchronized fun disconnect(id: String): JSONObject {
        val result = core.checked("POST", "/internal/disconnect", JSONObject().put("accountId", id)) as JSONObject
        check(result.getBoolean("ok") && result.getBoolean("historyRetained")) {
            "Native disconnect retention contract unavailable"
        }
        accounts.remove(id)
        return result
    }
}
