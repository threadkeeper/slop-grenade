package com.threadkeeper.slopgrenade.accounts

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Activity
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
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
    private val flow = ConsentFlow()

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
        val operation = try { flow.begin(email) } catch (failure: MailboxFailure) {
            return CompletableFuture<Pair<String, String>>().also { it.completeExceptionally(failure) }
        }
        if (email != null) authorize(activity, email, operation)
        else {
            try {
                val intent = AccountPicker.newChooseAccountIntent(AccountPicker.AccountChooserOptions.Builder()
                    .setAllowableAccountsTypes(listOf("com.google")).setAlwaysShowAccountPicker(true).build())
                activity.startActivityForResult(intent, operation.chooseCode)
            } catch (failure: Exception) { fail(operation, failure) }
        }
        return operation.future
    }

    private fun authorize(activity: Activity, email: String, operation: ConsentFlow.Attempt) {
        // authorize() itself can throw before a Task is returned. Always settle this attempt.
        try {
            Identity.getAuthorizationClient(activity).authorize(request(email))
                .addOnSuccessListener { result ->
                    if (flow.active !== operation) return@addOnSuccessListener
                    if (activity.isDestroyed || activity.isFinishing) {
                        flow.fail(operation, MailboxError.GOOGLE_CANCELLED)
                        return@addOnSuccessListener
                    }
                    try {
                        if (result.hasResolution()) {
                            val resolution = result.pendingIntent
                                ?: throw MailboxFailure(MailboxError.GOOGLE_UNAVAILABLE)
                            activity.startIntentSenderForResult(resolution.intentSender, operation.consentCode, null, 0, 0, 0)
                        } else flow.finish(operation, operation.selected, result.accessToken)
                    } catch (failure: Exception) { fail(operation, failure) }
                }.addOnFailureListener { failure -> fail(operation, failure) }
                .addOnCanceledListener { flow.fail(operation, MailboxError.GOOGLE_CANCELLED) }
        } catch (failure: Exception) { fail(operation, failure) }
    }

    fun onActivityResult(activity: Activity, code: Int, resultCode: Int, data: Intent?): Boolean {
        val operation = flow.active ?: return false
        if (code != operation.chooseCode && code != operation.consentCode) return false
        if (resultCode != Activity.RESULT_OK || data == null) {
            flow.fail(operation, MailboxError.GOOGLE_CANCELLED)
            return true
        }
        if (code == operation.chooseCode) {
            val email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)
            if (email.isNullOrBlank()) flow.fail(operation, MailboxError.GOOGLE_PERMISSION)
            else { operation.selected = email; authorize(activity, email, operation) }
        } else {
            try {
                val result = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
                flow.finish(operation, operation.selected, result.accessToken)
            } catch (failure: Exception) { fail(operation, failure) }
        }
        return true
    }

    fun cancel() { flow.active?.let { flow.fail(it, MailboxError.GOOGLE_CANCELLED) } }
    private fun fail(operation: ConsentFlow.Attempt, failure: Exception) {
        val cause = AuthorizationPolicy.unwrap(failure)
        flow.fail(operation, AuthorizationPolicy.classify(cause, (cause as? ApiException)?.statusCode))
    }
}
