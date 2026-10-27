package com.threadkeeper.slopgrenade.accounts

import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import org.junit.Assert.*
import org.junit.Test

class AuthorizationPolicyTest {
    @Test fun googleStatusesHaveDistinctSanitizedGuidance() {
        val expected = mapOf(10 to MailboxError.GOOGLE_CONFIGURATION, 7 to MailboxError.GOOGLE_NETWORK,
            15 to MailboxError.GOOGLE_NETWORK, 16 to MailboxError.GOOGLE_CANCELLED,
            12501 to MailboxError.GOOGLE_CANCELLED, 4 to MailboxError.GOOGLE_RECONNECT,
            8 to MailboxError.GOOGLE_UNAVAILABLE)
        expected.forEach { (status, error) ->
            assertEquals(error, AuthorizationPolicy.classify(Exception("private token/account"), status))
        }
        assertEquals(MailboxError.GOOGLE_PERMISSION, AuthorizationPolicy.classify(SecurityException("private")))
        assertEquals(MailboxError.UNKNOWN, AuthorizationPolicy.classify(Exception("private"), 99999))
        assertFalse(MailboxError.GOOGLE_CONFIGURATION.retryable)
        assertTrue(MailboxError.GOOGLE_NETWORK.retryable)
        assertEquals(409, MailboxError.AUTHORIZATION_ACTIVE.status)
        assertEquals(5, expected.values.toSet().size)
        assertEquals(422, MailboxError.GOOGLE_CONFIGURATION.status)
        assertEquals(503, MailboxError.GOOGLE_NETWORK.status)
        assertEquals(400, MailboxError.GOOGLE_CANCELLED.status)
        assertEquals(403, MailboxError.GOOGLE_PERMISSION.status)
        assertEquals(401, MailboxError.GOOGLE_RECONNECT.status)
    }

    @Test fun nestedCompletionErrorsRetainOnlyKnownCode() {
        val failure = MailboxFailure(MailboxError.GOOGLE_CANCELLED)
        assertSame(failure, AuthorizationPolicy.unwrap(CompletionException(ExecutionException(failure))))
        assertEquals("google_cancelled", failure.message)
        assertNull(failure.cause)
    }

    @Test fun cancelRetryAndStaleCallbacksCannotCompleteNewAttempt() {
        val flow = ConsentFlow()
        val first = flow.begin(null)
        try { flow.begin(null); fail("Concurrent consent accepted") }
        catch (failure: MailboxFailure) { assertEquals(MailboxError.AUTHORIZATION_ACTIVE, failure.error) }
        flow.fail(first, MailboxError.GOOGLE_CANCELLED)
        assertTrue(first.future.isCompletedExceptionally)
        val second = flow.begin("test@example.invalid")
        assertNotEquals(first.chooseCode, second.chooseCode)
        flow.fail(first, MailboxError.GOOGLE_NETWORK)
        flow.finish(first, "old@example.invalid", "synthetic-old")
        assertFalse(second.future.isDone)
        flow.finish(second, "test@example.invalid", "synthetic")
        assertEquals("synthetic", second.future.join().second)
        assertNull(flow.active)
    }

    @Test fun identityMismatchAndMissingPermissionDoNotSucceed() {
        val flow = ConsentFlow()
        val mismatch = flow.begin("first@example.invalid")
        flow.finish(mismatch, "second@example.invalid", "synthetic")
        assertTrue(mismatch.future.isCompletedExceptionally)
        val missingToken = flow.begin(null)
        flow.finish(missingToken, "test@example.invalid", null)
        assertTrue(missingToken.future.isCompletedExceptionally)
        assertNull(flow.active)
    }

    @Test fun synchronousFailureClearsAttemptBeforeObserversRetry() {
        val flow = ConsentFlow()
        val first = flow.begin(null)
        var retry: ConsentFlow.Attempt? = null
        first.future.whenComplete { _, _ -> retry = flow.begin(null) }
        flow.fail(first, AuthorizationPolicy.classify(SecurityException("private")))
        assertSame(retry, flow.active)
        flow.fail(first, MailboxError.UNKNOWN)
        assertFalse(retry!!.future.isDone)
    }

    @Test fun normalizedIdentitySuccessAndDuplicateCallbacksLeaveResultUnchanged() {
        val flow = ConsentFlow()
        val first = flow.begin("TEST@example.invalid")
        flow.finish(first, "test@example.invalid", "synthetic")
        flow.fail(first, MailboxError.GOOGLE_CANCELLED)
        flow.finish(first, "other@example.invalid", "different")
        assertEquals("synthetic", first.future.join().second)
        assertNull(flow.active)
    }
}
