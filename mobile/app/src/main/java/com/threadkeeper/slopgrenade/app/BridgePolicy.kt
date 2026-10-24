package com.threadkeeper.slopgrenade.app

/** Pure allowlist shared by both trusted WebViews. No internal/native admin endpoints are exposed. */
object BridgePolicy {
    const val ORIGIN = "https://appassets.androidplatform.net"
    fun trusted(origin: String, mainFrame: Boolean) = mainFrame && origin == ORIGIN
    fun nativeAllowed(method: String, path: String): Boolean = when (method) {
        "GET" -> path in setOf("/api/v1/ledger", "/api/v1/health", "/api/v1/auth/status", "/internal/session") ||
            path.matches(Regex("""/api/v1/events\?after=\d{1,19}"""))
        "POST" -> path in setOf("/api/v1/analyze", "/api/v1/simulate", "/api/v1/squeegee")
        else -> false
    }
}
