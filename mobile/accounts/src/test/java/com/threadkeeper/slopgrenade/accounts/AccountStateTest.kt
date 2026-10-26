package com.threadkeeper.slopgrenade.accounts

import org.junit.Assert.*
import org.junit.Test

class AccountStateTest {
    @Test fun identitiesAreNormalizedAndNonReversible() {
        val id = AccountState.identity(" Synthetic@Example.Invalid ")
        assertEquals(id, AccountState.identity("synthetic@example.invalid"))
        assertEquals(64, id.length)
        assertFalse(id.contains("@"))
        assertNotEquals(id, AccountState.identity("other@example.invalid"))
    }
    @Test fun checkpointRequiresSameProcessSession() {
        val account = AccountState("id", "synthetic@example.invalid", checkpoint = "42", session = "old")
        assertNull(account.checkpointFor("new"))
        assertEquals("42", account.checkpointFor("old"))
        assertNull(account.copy(reconnectRequired = true).checkpointFor("old"))
        assertNull(account.copy(checkpoint = null).checkpointFor("old"))
    }
    @Test fun authorizationFailureIsTypedAndDoesNotContainCredentials() {
        val failure = AuthorizationRequired()
        assertEquals("Account authorization required", failure.message)
    }
}
