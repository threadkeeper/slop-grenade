package com.threadkeeper.slopgrenade.accounts

import java.io.IOException
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException

/** Closed, non-sensitive vocabulary shared by authorization, the bridge, and the dashboard. */
enum class GoogleAuthorizationError(val code: String, val message: String, val httpStatus: Int) {
    USER_CANCELLED("google_auth_user_cancelled", "Google authorization was cancelled.", 409),
    CONFIGURATION("google_auth_configuration",
        "Google authorization configuration error. Check the Android OAuth package name and signing certificate.", 409),
    TRANSIENT("google_auth_transient",
        "Google authorization is temporarily unavailable. Check your network and Google Play Services, then retry.", 503),
    // Reserved for explicit typed policy evidence; AuthorizationClient 21.3.0 cannot supply it.
    WORKSPACE_POLICY_DENIED("google_auth_workspace_policy_denied",
        "Google Workspace policy blocks authorization. Contact your administrator.", 403),
    CONSENT_DENIED("google_auth_consent_denied",
        "Google did not grant Gmail read-only access. Check consent-screen and test-user access, then retry.", 403),
    UNKNOWN("google_auth_unknown",
        "Google authorization failed without a specific reason. Check Android OAuth configuration, account access, and Google Play Services.", 409);

    companion object {
        /**
         * CommonStatusCodes from play-services-base/basement, plus SIGN_IN_CANCELLED from auth.
         * Generic ERROR (13), CANCELED (16), and SIGN_IN_FAILED (12500) do not identify
         * user intent, a Workspace policy, or a consent-screen/test-user restriction.
         * AuthorizationClient 21.3.0 exposes no dedicated Workspace/test-user denial code.
         */
        fun fromStatus(status: Int): GoogleAuthorizationError = when (status) {
            10 -> CONFIGURATION // DEVELOPER_ERROR: misconfiguration, not proof of a particular bad certificate.
            2, 3, 7, 8, 15, 17, 19, 20, 21, 22 -> TRANSIENT
            12501 -> USER_CANCELLED // GoogleSignInStatusCodes.SIGN_IN_CANCELLED, not CommonStatusCodes.CANCELED.
            else -> UNKNOWN
        }

        /** Only the account chooser has an unambiguous cancellation result. */
        fun chooserResult(ok: Boolean, cancelled: Boolean, hasData: Boolean): GoogleAuthorizationError? =
            when {
                cancelled -> USER_CANCELLED
                !ok || !hasData -> UNKNOWN
                else -> null
            }

        /** Missing grants are evidence of denied consent, but not of the reason for that denial. */
        fun grantResult(hasRequiredScope: Boolean, hasToken: Boolean, identityMatches: Boolean): GoogleAuthorizationError? =
            when {
                !identityMatches -> UNKNOWN
                !hasRequiredScope -> CONSENT_DENIED
                !hasToken -> UNKNOWN
                else -> null
            }

        /** Unwrap only asynchronous transport wrappers; never inspect provider messages or arbitrary causes. */
        fun unwrap(failure: Throwable): Throwable {
            var value = failure
            repeat(8) {
                if (value !is CompletionException && value !is ExecutionException) return value
                value = value.cause ?: return value
            }
            return value
        }

        fun fromFailure(failure: Throwable): GoogleAuthorizationError = when (val value = unwrap(failure)) {
            is GoogleAuthorizationFailure -> value.error
            is AuthorizationRequired -> value.authorizationError
            is TimeoutException, is IOException -> TRANSIENT
            else -> UNKNOWN
        }
    }
}
