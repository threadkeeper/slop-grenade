package com.threadkeeper.slopgrenade.app

import android.content.Context
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.accounts.SecureAccounts
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class SecureAccountsTest {
    @Test fun authenticatedEncryptionUsesFreshNonceAndRejectsTampering() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "instrumentation_vault"
        val preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE)
        val vault = SecureAccounts(context, name)
        val account = AccountState(AccountState.identity("synthetic@example.invalid"), "synthetic@example.invalid")
        try {
            preferences.edit().clear().commit()
            vault.put(account)
            assertEquals(account, vault.all().single())
            val first = preferences.getString("blob", "")!!
            assertFalse(first.contains(account.label))
            vault.put(account)
            val second = preferences.getString("blob", "")!!
            assertNotEquals(JSONObject(first).getString("iv"), JSONObject(second).getString("iv"))
            val altered = JSONObject(second).put("ciphertext", "AAAA").toString()
            preferences.edit().putString("blob", altered).commit()
            try { vault.all(); fail("Tampered ciphertext accepted") }
            catch (_: IllegalStateException) { /* Fail closed, no plaintext fallback. */ }
        } finally {
            preferences.edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("slopgrenade.$name.v1") }
        }
    }
}
