package com.threadkeeper.slopgrenade.accounts

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Activity
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.AccountPicker
import com.google.android.gms.common.api.Scope
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Supported Google account chooser + AuthorizationClient; tokens are never stored. */
class GoogleAccounts(private val context: Context) {
    class Reconnect : AuthorizationRequired()
    class Transient : Exception("Google authorization temporarily unavailable")
    private val scope = Scope("https://www.googleapis.com/auth/gmail.readonly")
    private var pending: CompletableFuture<Pair<String, String>>? = null
    private var selected: String? = null
    private var expected: String? = null
    private val chooseCode = 4101
    private val consentCode = 4102

    private fun request(email: String) = AuthorizationRequest.builder()
        .setAccount(Account(email, "com.google")).setRequestedScopes(listOf(scope)).build()

    /** Background path deliberately never launches a consent activity. Call off the main thread. */
    fun token(email: String): String {
        val result = try {
            Tasks.await(Identity.getAuthorizationClient(context).authorize(request(email)), 60, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw e
        } catch (e: Exception) {
            val cause = e.cause ?: e
            if (cause is java.util.concurrent.TimeoutException ||
                (cause is ApiException && cause.statusCode in setOf(CommonStatusCodes.NETWORK_ERROR,
                    CommonStatusCodes.INTERNAL_ERROR, CommonStatusCodes.TIMEOUT)))
                throw Transient()
            throw Reconnect()
        }
        if (result.hasResolution()) throw Reconnect()
        return result.accessToken ?: throw Reconnect()
    }

    /** Must be invoked on main; concurrent consent requests are rejected rather than misrouted. */
    fun connect(activity: Activity, email: String? = null): CompletableFuture<Pair<String, String>> {
        if (pending != null) return CompletableFuture<Pair<String, String>>().also {
            it.completeExceptionally(IllegalStateException("Authorization already active"))
        }
        val result = CompletableFuture<Pair<String, String>>()
        pending = result
        expected = email
        selected = email
        if (email != null) authorize(activity, email)
        else {
            try {
                val intent = AccountPicker.newChooseAccountIntent(AccountPicker.AccountChooserOptions.Builder()
                    .setAllowableAccountsTypes(listOf("com.google")).setAlwaysShowAccountPicker(true).build())
                activity.startActivityForResult(intent, chooseCode)
            } catch (_: Exception) { fail() }
        }
        return result
    }

    private fun authorize(activity: Activity, email: String) {
        val operation = pending ?: return
        Identity.getAuthorizationClient(activity).authorize(request(email))
            .addOnSuccessListener { result ->
                if (pending !== operation || activity.isDestroyed || activity.isFinishing) return@addOnSuccessListener
                if (result.hasResolution()) {
                    try {
                        activity.startIntentSenderForResult(result.pendingIntent!!.intentSender, consentCode, null, 0, 0, 0)
                    } catch (_: Exception) { fail() }
                } else finish(result)
            }.addOnFailureListener { fail() }
    }

    fun onActivityResult(activity: Activity, code: Int, resultCode: Int, data: Intent?): Boolean {
        if (code != chooseCode && code != consentCode) return false
        if (pending == null) return true
        if (resultCode != Activity.RESULT_OK || data == null) { fail(); return true }
        if (code == chooseCode) {
            val email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)
            if (email.isNullOrBlank()) fail()
            else { selected = email; authorize(activity, email) }
        } else {
            try { finish(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)) }
            catch (_: Exception) { fail() }
        }
        return true
    }

    private fun finish(result: AuthorizationResult) {
        val email = selected
        val token = result.accessToken
        if (email == null || token == null || (expected != null && AccountState.identity(email) != AccountState.identity(expected!!))) {
            fail(); return
        }
        val future = pending
        pending = null; selected = null; expected = null
        future?.complete(email to token)
    }

    fun cancel() = fail()
    private fun fail() {
        val future = pending
        pending = null; selected = null; expected = null
        future?.completeExceptionally(Reconnect())
    }
}
