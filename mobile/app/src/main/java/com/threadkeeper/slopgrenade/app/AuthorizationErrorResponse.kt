package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.GoogleAuthorizationError
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONObject

/** Native errors contain only an allowlisted code and a static message, never Google error text. */
object AuthorizationErrorResponse {
    fun from(failure: Throwable?): JSONObject {
        val value = failure?.let { GoogleAuthorizationError.unwrap(it) }
        val error = when {
            // Gmail 403 alone cannot distinguish Workspace policy, consent, API setup, or quota.
            value is GmailClient.Failure -> when {
                value.status == 429 || value.status >= 500 -> GoogleAuthorizationError.TRANSIENT
                else -> GoogleAuthorizationError.UNKNOWN
            }
            value != null -> GoogleAuthorizationError.fromFailure(value)
            else -> GoogleAuthorizationError.UNKNOWN
        }
        return JSONObject().put("status", error.httpStatus)
            .put("body", JSONObject().put("error", error.message).put("code", error.code))
    }
}
