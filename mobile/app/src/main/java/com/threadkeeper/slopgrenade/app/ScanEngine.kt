package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.AccountRepository
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONObject
import java.time.Instant

/**
 * Serializes scan/ingest/checkpoint/disconnect transactions in this process.
 * Disconnect waits for an in-flight transaction and purges last, so it cannot be resurrected.
 */
class ScanEngine(
    private val accounts: AccountRepository,
    private val core: CoreApi,
    private val token: (AccountState) -> String,
    private val fetch: (AccountState, String, String?) -> GmailClient.Batch,
) {
    @Volatile var status: String = "Not scanned"
        private set

    /** Returns true only for transient failures that WorkManager should retry. */
    @Synchronized fun scanAll(): Boolean {
        var retry = false
        var missingBody = false
        val session = (core.checked("GET", "/internal/session") as JSONObject).getString("sessionId")
        for (account in accounts.all()) {
            if (Thread.currentThread().isInterrupted) throw InterruptedException()
            if (account.reconnectRequired) continue
            try {
                val checkpoint = account.checkpointFor(session)
                val batch = fetch(account, token(account), checkpoint)
                if (Thread.currentThread().isInterrupted) throw InterruptedException()
                core.checked("POST", "/internal/ingest", JSONObject().put("samples", batch.samples())
                    .put("quiet", checkpoint == null || batch.resynced()))
                accounts.put(account.copy(checkpoint = batch.historyId(), session = session,
                    lastSuccessfulScan = Instant.now().toString(), reconnectRequired = false))
            } catch (e: GmailClient.Failure) {
                if (e.requiresReconnect()) accounts.put(account.copy(reconnectRequired = true))
                else {
                    retry = true
                    missingBody = missingBody || e.status == 422
                }
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                throw e
            } catch (_: Exception) {
                retry = true
            }
        }
        status = when {
            missingBody -> "Message MIME body unavailable; scan incomplete, checkpoint unchanged for affected accounts"
            retry -> "Temporary failure; retry scheduled"
            else -> "Scan complete; background work is best effort"
        }
        return retry
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

    @Synchronized fun disconnect(id: String) {
        core.checked("POST", "/internal/disconnect", JSONObject().put("accountId", id))
        accounts.remove(id)
    }
}
