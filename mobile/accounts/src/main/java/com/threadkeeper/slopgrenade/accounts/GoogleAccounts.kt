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
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Supported Google account chooser + AuthorizationClient; tokens are never stored. */
class GoogleAccounts(private val context: Context) {
    class Reconnect(error: GoogleAuthorizationError = GoogleAuthorizationError.UNKNOWN) : AuthorizationRequired(error)
    class Transient : GoogleAuthorizationFailure(GoogleAuthorizationError.TRANSIENT)
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
            throw InterruptedException()
        } catch (e: Exception) {
            val error = classify(e)
            if (error == GoogleAuthorizationError.TRANSIENT) throw Transient()
            throw Reconnect(error)
        }
        if (result.hasResolution()) throw Reconnect()
        if (!result.grantedScopes.contains(scope.scopeUri))
            throw Reconnect(GoogleAuthorizationError.CONSENT_DENIED)
        return result.accessToken?.takeIf { it.isNotBlank() } ?: throw Reconnect()
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
            } catch (e: Exception) { fail(classify(e)) }
        }
        return result
    }

    private fun authorize(activity: Activity, email: String) {
        val operation = pending ?: return
        try {
            Identity.getAuthorizationClient(activity).authorize(request(email))
                .addOnSuccessListener { result ->
                    if (pending !== operation) return@addOnSuccessListener
                    if (activity.isDestroyed || activity.isFinishing) { fail(); return@addOnSuccessListener }
                    if (result.hasResolution()) {
                        try {
                            activity.startIntentSenderForResult(result.pendingIntent!!.intentSender, consentCode, null, 0, 0, 0)
                        } catch (e: Exception) { fail(classify(e)) }
                    } else finish(result)
                }.addOnFailureListener { if (pending === operation) fail(classify(it)) }
        } catch (e: Exception) { if (pending === operation) fail(classify(e)) }
    }

    fun onActivityResult(activity: Activity, code: Int, resultCode: Int, data: Intent?): Boolean {
        if (code != chooseCode && code != consentCode) return false
        if (pending == null) return true
        if (code == chooseCode) {
            val error = GoogleAuthorizationError.chooserResult(
                resultCode == Activity.RESULT_OK, resultCode == Activity.RESULT_CANCELED, data != null)
            if (error != null) { fail(error); return true }
            val email = data?.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)
            if (email.isNullOrBlank()) fail()
            else { selected = email; authorize(activity, email) }
        } else {
            // Consent can return RESULT_CANCELED for several different upstream failures.
            // Read a typed status when available; an empty result is not proof of user intent.
            if (data == null) { fail(); return true }
            try { finish(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)) }
            catch (e: Exception) { fail(classify(e)) }
        }
        return true
    }

    private fun finish(result: AuthorizationResult) {
        val email = selected
        val token = result.accessToken
        val error = GoogleAuthorizationError.grantResult(
            result.grantedScopes.contains(scope.scopeUri), !token.isNullOrBlank(),
            email != null && (expected == null || AccountState.identity(email) == AccountState.identity(expected!!)))
        if (error != null) { fail(error); return }
        val future = pending
        pending = null; selected = null; expected = null
        future?.complete(email!! to token!!)
    }

    fun cancel() = fail()
    private fun fail(error: GoogleAuthorizationError = GoogleAuthorizationError.UNKNOWN) {
        val future = pending
        pending = null; selected = null; expected = null
        future?.completeExceptionally(GoogleAuthorizationFailure(error))
    }

    private fun classify(failure: Throwable): GoogleAuthorizationError {
        val value = GoogleAuthorizationError.unwrap(failure)
        return if (value is ApiException) GoogleAuthorizationError.fromStatus(value.statusCode)
            else GoogleAuthorizationError.fromFailure(value)
    }
}
