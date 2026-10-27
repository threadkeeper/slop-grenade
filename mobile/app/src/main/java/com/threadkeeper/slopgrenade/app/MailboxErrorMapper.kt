package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.AuthorizationPolicy
import com.threadkeeper.slopgrenade.accounts.MailboxError
import com.threadkeeper.slopgrenade.accounts.MailboxFailure
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONObject
import java.io.IOException

/** Only allowlisted codes cross the bridge. Provider text and exception chains never do. */
object MailboxErrorMapper {
    fun body(failure: Throwable): JSONObject {
        val cause = AuthorizationPolicy.unwrap(failure)
        val error = when (cause) {
            is MailboxFailure -> cause.error
            is GmailClient.Failure -> when (cause.status) {
                401 -> MailboxError.GMAIL_RECONNECT
                403 -> MailboxError.GMAIL_PERMISSION
                409 -> MailboxError.CONFLICT
                429 -> MailboxError.GMAIL_RATE_LIMITED
                in 500..599 -> MailboxError.GMAIL_UNAVAILABLE
                else -> MailboxError.UNKNOWN
            }
            is IOException -> MailboxError.GOOGLE_NETWORK
            else -> MailboxError.UNKNOWN
        }
        return response(error)
    }

    fun response(error: MailboxError): JSONObject = JSONObject().put("status", error.status)
        .put("body", JSONObject().put("code", error.code).put("retryable", error.retryable))
}
