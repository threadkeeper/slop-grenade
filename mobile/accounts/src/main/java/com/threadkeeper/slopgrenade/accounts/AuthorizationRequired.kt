package com.threadkeeper.slopgrenade.accounts

/** Typed non-transient authentication failure understood by the scanner without Android classes. */
open class AuthorizationRequired(
    val authorizationError: GoogleAuthorizationError = GoogleAuthorizationError.UNKNOWN,
) : Exception(authorizationError.message)
