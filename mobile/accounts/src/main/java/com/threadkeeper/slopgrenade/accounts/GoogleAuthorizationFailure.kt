package com.threadkeeper.slopgrenade.accounts

/** Deliberately drops the upstream cause, message, account identity, and authorization payload. */
open class GoogleAuthorizationFailure(val error: GoogleAuthorizationError) : Exception(error.message)
