package com.threadkeeper.slopgrenade.app

import org.junit.Assert.*
import org.junit.Test

class BridgePolicyTest {
    @Test fun onlyExactOriginAndMainFrameCanUseBridge() {
        assertTrue(BridgePolicy.trusted("https://appassets.androidplatform.net", true))
        listOf("http://appassets.androidplatform.net", "https://evil.invalid",
            "https://appassets.androidplatform.net.evil.invalid", "https://appassets.androidplatform.net:443")
            .forEach { assertFalse(BridgePolicy.trusted(it, true)) }
        assertFalse(BridgePolicy.trusted(BridgePolicy.ORIGIN, false))
    }
    @Test fun internalEndpointsAndArbitraryUrlsAreRejected() {
        assertTrue(BridgePolicy.nativeAllowed("GET", "/api/v1/events?after=12"))
        assertTrue(BridgePolicy.nativeAllowed("GET", "/internal/session"))
        assertTrue(BridgePolicy.nativeAllowed("POST", "/api/v1/analyze"))
        assertFalse(BridgePolicy.nativeAllowed("POST", "/internal/ingest"))
        assertFalse(BridgePolicy.nativeAllowed("POST", "/api/v1/gmail/details"))
        assertFalse(BridgePolicy.nativeAllowed("GET", "https://evil.invalid"))
        assertFalse(BridgePolicy.nativeAllowed("DELETE", "/api/v1/ledger"))
        assertFalse(BridgePolicy.nativeAllowed("GET", "/api/v1/events?after=-1"))
    }
}
