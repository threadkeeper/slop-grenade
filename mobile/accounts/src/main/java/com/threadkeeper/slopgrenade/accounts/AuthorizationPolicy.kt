package com.threadkeeper.slopgrenade.accounts

import java.io.IOException
import java.util.concurrent.CancellationException
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException

/** Closed, privacy-safe wire vocabulary. Retryable means retry without configuration changes. */
enum class MailboxError(val code: String, val status: Int, val retryable: Boolean) {
    AUTHORIZATION_ACTIVE("authorization_active", 409, true),
    GOOGLE_CONFIGURATION("google_configuration", 422, false),
    GOOGLE_NETWORK("google_network", 503, true),
    GOOGLE_CANCELLED("google_cancelled", 400, true),
    GOOGLE_PERMISSION("google_permission", 403, false),
    GOOGLE_RECONNECT("google_reconnect", 401, false),
    GOOGLE_UNAVAILABLE("google_unavailable", 503, true),
    GMAIL_RECONNECT("gmail_reconnect", 401, false),
    GMAIL_PERMISSION("gmail_permission", 403, false),
    GMAIL_RATE_LIMITED("gmail_rate_limited", 429, true),
    GMAIL_UNAVAILABLE("gmail_unavailable", 502, true),
    IDENTITY_MISMATCH("mailbox_identity_mismatch", 422, false),
    ACCOUNT_NOT_FOUND("mailbox_account_not_found", 404, false),
    CONFLICT("mailbox_conflict", 409, false),
    UNKNOWN("mailbox_unknown", 500, false)
}

/** Contains no original exception, account, token, or provider text. */
class MailboxFailure(val error: MailboxError) : Exception(error.code)

/** Pure policy; numeric Google codes are SDK constants, not raw diagnostic strings. */
object AuthorizationPolicy {
    /** Unwrap only asynchronous completion wrappers, with a bound for hostile/cyclic causes. */
    fun unwrap(failure: Throwable): Throwable {
        var current = failure
        repeat(16) {
            if (current !is CompletionException && current !is ExecutionException) return current
            current = current.cause ?: return current
        }
        return current
    }

    /** Classify interactive failures without retaining or exposing exception messages. */
    fun classify(failure: Throwable, googleStatus: Int? = null): MailboxError {
        val cause = unwrap(failure)
        if (cause is MailboxFailure) return cause.error
        return when {
            cause is CancellationException -> MailboxError.GOOGLE_CANCELLED
            cause is SecurityException -> MailboxError.GOOGLE_PERMISSION
            cause is IOException || cause is TimeoutException -> MailboxError.GOOGLE_NETWORK
            googleStatus == 10 -> MailboxError.GOOGLE_CONFIGURATION // DEVELOPER_ERROR
            googleStatus in setOf(7, 15) -> MailboxError.GOOGLE_NETWORK // NETWORK_ERROR, TIMEOUT
            googleStatus in setOf(16, 12501) -> MailboxError.GOOGLE_CANCELLED
            googleStatus in setOf(4, 6) -> MailboxError.GOOGLE_RECONNECT
            googleStatus in setOf(8, 14, 17, 20) -> MailboxError.GOOGLE_UNAVAILABLE
            else -> MailboxError.UNKNOWN
        }
    }
}
