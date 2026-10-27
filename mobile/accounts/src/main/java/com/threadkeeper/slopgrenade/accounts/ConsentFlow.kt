package com.threadkeeper.slopgrenade.accounts

import java.util.concurrent.CompletableFuture

/** Main-thread-only interactive state; obsolete callbacks cannot settle a newer attempt. */
class ConsentFlow {
    /** Ephemeral credentials exist only in the completion future, never in diagnostics. */
    class Attempt internal constructor(val expected: String?, val chooseCode: Int) {
        val consentCode = chooseCode + 1
        var selected: String? = expected
        val future = CompletableFuture<Pair<String, String>>()
    }

    var active: Attempt? = null
        private set
    private var nextCode = 4101

    /** Unique request codes also reject stale Android activity results after cancellation. */
    fun begin(expected: String?): Attempt {
        if (active != null) throw MailboxFailure(MailboxError.AUTHORIZATION_ACTIVE)
        // Android request codes must fit in 16 bits; fail closed rather than reuse a stale code.
        if (nextCode > 65533) throw MailboxFailure(MailboxError.GOOGLE_UNAVAILABLE)
        return Attempt(expected, nextCode).also { nextCode += 2; active = it }
    }

    /** Clear state before notifying observers, so an immediate retry is safe. */
    fun fail(attempt: Attempt, error: MailboxError) {
        if (active !== attempt) return
        active = null
        attempt.future.completeExceptionally(MailboxFailure(error))
    }

    /** Validate chooser identity; the router independently verifies the Gmail profile identity. */
    fun finish(attempt: Attempt, email: String?, token: String?) {
        if (active !== attempt) return
        if (email.isNullOrBlank() || token.isNullOrBlank()) {
            fail(attempt, MailboxError.GOOGLE_PERMISSION)
        } else if (attempt.expected != null && AccountState.identity(email) != AccountState.identity(attempt.expected)) {
            fail(attempt, MailboxError.IDENTITY_MISMATCH)
        } else {
            active = null
            attempt.future.complete(email to token)
        }
    }
}
