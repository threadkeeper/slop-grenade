package com.threadkeeper.slopgrenade.app

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

class ContentSecurityPolicyTest {
    @Test fun exactBootstrapHashAllowsOnlyPackagedInlineText() {
        val script = "\n\tconst element = document.currentScript.parentElement;\n"
        val policy = ContentSecurityPolicy.forIndex("<script>$script</script>")
        val expected = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(script.toByteArray()))
        assertTrue(policy.contains("'sha256-$expected'"))
        val scripts = policy.substringAfter("script-src ").substringBefore(';')
        assertTrue(scripts.contains("'self'"))
        assertFalse(scripts.contains("'unsafe-inline'"))
        assertFalse(scripts.contains("'unsafe-eval'"))
        assertNotEquals(policy, ContentSecurityPolicy.forIndex("<script>${script.trim()}</script>"))
        assertTrue(policy.contains("connect-src 'none'"))
    }
    @Test fun externalScriptsNeedNoInlineHashAndHashDoesNotAuthorizeHandlers() {
        val policy = ContentSecurityPolicy.forIndex("""<script src="/_app/start.js"></script><button onclick="alert(1)">Test</button>""")
        assertFalse(policy.contains("sha256-"))
        assertFalse(policy.contains("unsafe-hashes"))
    }
    @Test fun htmlLineEndingNormalizationMatchesBrowserAndAllBootstrapsAreHashed() {
        assertEquals(ContentSecurityPolicy.forIndex("<script>a\nb</script>"),
            ContentSecurityPolicy.forIndex("<script>a\r\nb</script>"))
        val policy = ContentSecurityPolicy.forIndex("<script>one</script><script type=\"module\">two</script>")
        assertEquals(2, Regex("sha256-").findAll(policy).count())
    }
}
