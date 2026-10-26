package com.threadkeeper.slopgrenade.accounts

import java.security.MessageDigest
import java.util.Locale

/** Only account/config metadata is persisted; never credentials or message payloads. */
data class AccountState(
    val id: String,
    val label: String,
    val checkpoint: String? = null,
    val session: String? = null,
    val lastSuccessfulScan: String? = null,
    val reconnectRequired: Boolean = false,
) {
    fun checkpointFor(coreSession: String): String? =
        if (!reconnectRequired && session == coreSession) checkpoint else null

    companion object {
        fun identity(email: String): String = MessageDigest.getInstance("SHA-256")
            .digest(email.trim().lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
