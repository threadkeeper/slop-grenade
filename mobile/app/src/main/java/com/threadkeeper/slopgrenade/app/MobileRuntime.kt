package com.threadkeeper.slopgrenade.app

import android.content.Context
import com.threadkeeper.slopgrenade.accounts.GoogleAccounts
import com.threadkeeper.slopgrenade.accounts.SecureAccounts
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.core.ManualAnalysis
import com.threadkeeper.slopgrenade.gmail.GmailClient
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Application-context singleton; neither worker nor service retains an Activity. */
class MobileRuntime private constructor(context: Context) {
    val accounts = SecureAccounts(context)
    val google = GoogleAccounts(context)
    val core = CoreApi()
    val manual = ManualAnalysis(core)
    val io = Executors.newFixedThreadPool(3)
    val consentActive = AtomicBoolean(false)
    val engine = ScanEngine(accounts, core, { account ->
        try { google.token(account.label) }
        catch (_: GoogleAccounts.Reconnect) { throw GmailClient.Failure(401, 0) }
        catch (_: GoogleAccounts.Transient) { throw GmailClient.Failure(503, 0) }
    }, { account, token, checkpoint ->
        GmailClient(GmailClient.https(token)).scan(account.id, checkpoint)
    })

    companion object {
        @Volatile private var instance: MobileRuntime? = null
        fun get(context: Context): MobileRuntime = instance ?: synchronized(this) {
            instance ?: MobileRuntime(context.applicationContext).also { instance = it }
        }
    }
}
