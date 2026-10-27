package com.threadkeeper.slopgrenade.app

import com.threadkeeper.slopgrenade.accounts.AccountRepository
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.accounts.AuthorizationRequired
import com.threadkeeper.slopgrenade.accounts.GoogleAuthorizationError
import com.threadkeeper.slopgrenade.accounts.GoogleAuthorizationFailure
import com.threadkeeper.slopgrenade.core.CoreApi
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException

class AuthorizationErrorResponseTest {
    @Test fun allSixCategoriesUseOnlyStaticCodesMessagesAndStatus() {
        GoogleAuthorizationError.entries.forEach { category ->
            val response = AuthorizationErrorResponse.from(
                CompletionException(ExecutionException(GoogleAuthorizationFailure(category))))
            assertEquals(category.httpStatus, response.getInt("status"))
            val body = response.getJSONObject("body")
            assertEquals(setOf("error", "code"), body.keys().asSequence().toSet())
            assertEquals(category.code, body.getString("code"))
            assertEquals(category.message, body.getString("error"))
        }
        assertEquals(6, GoogleAuthorizationError.entries.map { it.code }.toSet().size)
    }

    @Test fun rawFailuresAndGenericGmailPermissionDenialsRemainUnknown() {
        listOf(null, IllegalArgumentException("synthetic@example.invalid synthetic-token admin_policy_enforced"),
            GmailClient.Failure(401, 0), GmailClient.Failure(403, 0)).forEach { failure ->
            val response = AuthorizationErrorResponse.from(failure)
            val body = response.getJSONObject("body")
            assertEquals("google_auth_unknown", body.getString("code"))
            assertEquals(GoogleAuthorizationError.UNKNOWN.message, body.getString("error"))
            assertFalse(response.toString().contains("synthetic"))
            assertFalse(response.toString().contains("admin_policy_enforced"))
        }
    }

    @Test fun profileNetworkServiceAndQuotaFailuresAreNotReportedAsCancellation() {
        listOf(429, 500, 503).forEach { status ->
            val response = AuthorizationErrorResponse.from(CompletionException(GmailClient.Failure(status, 0)))
            assertEquals(503, response.getInt("status"))
            assertEquals("google_auth_transient", response.getJSONObject("body").getString("code"))
        }
    }

    @Test fun typedBackgroundAuthFailureRequiresReconnectWithoutAdvancingCheckpoint() {
        val (engine, stored) = scanner(AuthorizationRequired(GoogleAuthorizationError.CONFIGURATION))
        assertFalse(engine.scanAll())
        assertTrue(stored.single().reconnectRequired)
        assertEquals("old-checkpoint", stored.single().checkpoint)
        assertTrue(engine.status.contains("Reconnect required"))
    }

    @Test fun typedTransientFailureRetriesWithoutRequiringReconnectOrAdvancingCheckpoint() {
        val (engine, stored) = scanner(GoogleAuthorizationFailure(GoogleAuthorizationError.TRANSIENT))
        assertTrue(engine.scanAll())
        assertFalse(stored.single().reconnectRequired)
        assertEquals("old-checkpoint", stored.single().checkpoint)
        assertTrue(engine.status.contains("Temporary failure"))
    }

    private fun scanner(failure: Exception): Pair<ScanEngine, MutableList<AccountState>> {
        val stored = mutableListOf(AccountState("synthetic-id", "synthetic@example.invalid",
            checkpoint = "old-checkpoint", session = "synthetic-session"))
        val accounts = object : AccountRepository {
            override fun all() = stored.toList()
            override fun put(account: AccountState) { stored[0] = account }
            override fun remove(id: String) { stored.clear() }
        }
        val core = CoreApi {
            val request = JSONObject(it)
            assertEquals("/internal/session", request.getString("path"))
            """{"status":200,"body":{"sessionId":"synthetic-session"}}"""
        }
        return ScanEngine(accounts, core, { throw failure }, { _, _, _ ->
            throw AssertionError("A failed token request must not fetch Gmail")
        }) to stored
    }
}
