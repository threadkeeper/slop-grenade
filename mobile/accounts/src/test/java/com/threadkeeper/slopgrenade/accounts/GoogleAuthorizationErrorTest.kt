package com.threadkeeper.slopgrenade.accounts

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException

class GoogleAuthorizationErrorTest {
    @Test fun developerErrorIdentifiesConfigurationWithoutClaimingAnExactCause() {
        assertEquals(GoogleAuthorizationError.CONFIGURATION, GoogleAuthorizationError.fromStatus(10))
        assertTrue(GoogleAuthorizationError.CONFIGURATION.message.contains("package name"))
        assertTrue(GoogleAuthorizationError.CONFIGURATION.message.contains("signing certificate"))
    }

    @Test fun documentedNetworkAndServiceFailuresAreRetryable() {
        listOf(2, 3, 7, 8, 15, 17, 19, 20, 21, 22).forEach {
            assertEquals("status $it", GoogleAuthorizationError.TRANSIENT, GoogleAuthorizationError.fromStatus(it))
        }
        listOf(IOException("synthetic transport detail"), TimeoutException("synthetic timeout")).forEach {
            assertEquals(GoogleAuthorizationError.TRANSIENT, GoogleAuthorizationError.fromFailure(ExecutionException(it)))
        }
    }

    @Test fun genericProviderCodesDoNotInventPolicyTestUserOrUserCancellationEvidence() {
        listOf(-1, 0, 4, 5, 6, 13, 14, 16, 12500, 12502, 28400, Int.MAX_VALUE).forEach {
            assertEquals("status $it", GoogleAuthorizationError.UNKNOWN, GoogleAuthorizationError.fromStatus(it))
        }
        assertEquals(GoogleAuthorizationError.USER_CANCELLED, GoogleAuthorizationError.fromStatus(12501))
    }

    @Test fun accountChooserCancellationIsDistinctFromMalformedResults() {
        assertEquals(GoogleAuthorizationError.USER_CANCELLED,
            GoogleAuthorizationError.chooserResult(ok = false, cancelled = true, hasData = false))
        assertEquals(GoogleAuthorizationError.UNKNOWN,
            GoogleAuthorizationError.chooserResult(ok = false, cancelled = false, hasData = true))
        assertEquals(GoogleAuthorizationError.UNKNOWN,
            GoogleAuthorizationError.chooserResult(ok = true, cancelled = false, hasData = false))
        assertNull(GoogleAuthorizationError.chooserResult(ok = true, cancelled = false, hasData = true))
    }

    @Test fun deniedReadOnlyGrantDoesNotClaimWorkspaceOrTestUserRestriction() {
        assertEquals(GoogleAuthorizationError.CONSENT_DENIED,
            GoogleAuthorizationError.grantResult(hasRequiredScope = false, hasToken = false, identityMatches = true))
        assertEquals(GoogleAuthorizationError.UNKNOWN,
            GoogleAuthorizationError.grantResult(hasRequiredScope = true, hasToken = false, identityMatches = true))
        assertEquals(GoogleAuthorizationError.UNKNOWN,
            GoogleAuthorizationError.grantResult(hasRequiredScope = false, hasToken = true, identityMatches = false))
        assertNull(GoogleAuthorizationError.grantResult(hasRequiredScope = true, hasToken = true, identityMatches = true))
    }

    @Test fun onlyTypedCategoriesSurviveAsyncWrappersWithoutProviderPayloads() {
        GoogleAuthorizationError.entries.forEach { category ->
            val failure = GoogleAuthorizationFailure(category)
            assertEquals(category, GoogleAuthorizationError.fromFailure(
                CompletionException(ExecutionException(failure))))
            assertEquals(category.message, failure.message)
            assertNull(failure.cause)
            assertTrue(failure.suppressed.isEmpty())
            assertEquals(category, GoogleAuthorizationError.fromFailure(AuthorizationRequired(category)))
        }
        val raw = IllegalStateException("admin_policy_enforced access_denied invalid_client synthetic@example.invalid synthetic-token")
        assertEquals(GoogleAuthorizationError.UNKNOWN, GoogleAuthorizationError.fromFailure(raw))
        // An arbitrary exception cause is not a trusted provider status.
        assertEquals(GoogleAuthorizationError.UNKNOWN,
            GoogleAuthorizationError.fromFailure(IllegalStateException(raw.message,
                GoogleAuthorizationFailure(GoogleAuthorizationError.WORKSPACE_POLICY_DENIED))))
    }

    @Test fun asynchronousUnwrappingIsBounded() {
        var value: Throwable = GoogleAuthorizationFailure(GoogleAuthorizationError.CONFIGURATION)
        repeat(20) { value = CompletionException(value) }
        assertEquals(GoogleAuthorizationError.UNKNOWN, GoogleAuthorizationError.fromFailure(value))
    }
}
