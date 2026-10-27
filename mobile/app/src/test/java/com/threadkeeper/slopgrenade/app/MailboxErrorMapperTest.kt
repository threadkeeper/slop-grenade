package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.MailboxError
import com.threadkeeper.slopgrenade.accounts.MailboxFailure
import com.threadkeeper.slopgrenade.gmail.GmailClient
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import org.junit.Assert.*
import org.junit.Test

class MailboxErrorMapperTest {
    @Test fun profileFailuresAreNotConsentConflicts() {
        mapOf(401 to MailboxError.GMAIL_RECONNECT, 403 to MailboxError.GMAIL_PERMISSION,
            429 to MailboxError.GMAIL_RATE_LIMITED, 503 to MailboxError.GMAIL_UNAVAILABLE,
            409 to MailboxError.CONFLICT).forEach { (status, expected) ->
            val result = MailboxErrorMapper.body(CompletionException(ExecutionException(GmailClient.Failure(status, 0))))
            assertEquals(expected.status, result.getInt("status"))
            assertEquals(expected.code, result.getJSONObject("body").getString("code"))
            assertEquals(expected.retryable, result.getJSONObject("body").getBoolean("retryable"))
        }
    }

    @Test fun unknownFailureNeverSerializesRawData() {
        val result = MailboxErrorMapper.body(CompletionException(IllegalStateException("secret@example.invalid token")))
        assertEquals(500, result.getInt("status"))
        assertEquals(setOf("code", "retryable"), result.getJSONObject("body").keySet())
        assertFalse(result.toString().contains("secret"))
        assertFalse(result.toString().contains("IllegalState"))
    }

    @Test fun knownErrorsSurviveNestedCompletion() {
        val result = MailboxErrorMapper.body(CompletionException(MailboxFailure(MailboxError.GOOGLE_CONFIGURATION)))
        assertEquals(422, result.getInt("status"))
        assertEquals("google_configuration", result.getJSONObject("body").getString("code"))
    }

    @Test fun onlyExplicitConflictsUse409() {
        MailboxError.entries.forEach { error ->
            val result = MailboxErrorMapper.body(ExecutionException(MailboxFailure(error)))
            assertEquals(error.status, result.getInt("status"))
            assertEquals(error.code, result.getJSONObject("body").getString("code"))
            assertEquals(error.retryable, result.getJSONObject("body").getBoolean("retryable"))
            assertEquals(error in setOf(MailboxError.AUTHORIZATION_ACTIVE, MailboxError.CONFLICT),
                result.getInt("status") == 409)
        }
        val result = MailboxErrorMapper.body(GmailClient.Failure(418, 0))
        assertEquals(500, result.getInt("status"))
        assertEquals("mailbox_unknown", result.getJSONObject("body").getString("code"))
    }
}
