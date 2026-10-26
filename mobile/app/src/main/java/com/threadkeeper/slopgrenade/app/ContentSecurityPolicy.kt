package com.threadkeeper.slopgrenade.app

import java.security.MessageDigest
import java.util.Base64

/** Authorizes only the exact inline script text shipped in the trusted bundled index. */
object ContentSecurityPolicy {
    fun forIndex(html: String): String {
        // HTML parsing normalizes CRLF/CR before the browser computes inline-script hashes.
        val normalized = html.replace("\r\n", "\n").replace("\r", "\n")
        val scripts = Regex("<script\\b([^>]*)>(.*?)</script\\s*>",
            setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
        val hashes = scripts.findAll(normalized).filterNot {
            Regex("(?:^|\\s)src\\s*=", RegexOption.IGNORE_CASE).containsMatchIn(it.groupValues[1])
        }.map {
            val digest = MessageDigest.getInstance("SHA-256").digest(it.groupValues[2].toByteArray(Charsets.UTF_8))
            "'sha256-${Base64.getEncoder().encodeToString(digest)}'"
        }.distinct().joinToString(" ")
        return "default-src 'self'; script-src 'self'${if (hashes.isEmpty()) "" else " $hashes"}; " +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; " +
            "object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    }
}
