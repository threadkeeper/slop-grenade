package com.threadkeeper.slopgrenade.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OverlaySoundPreferencesTest {
    @Test fun defaultOverlayIsSilentAndGestureRequired() {
        val preferences = OverlaySoundPreferences()
        assertEquals(BridgePolicy.ORIGIN + "/index.html?mode=overlay", preferences.url())
        assertTrue(preferences.requiresGesture(overlay = true))
        assertTrue(preferences.requiresGesture(overlay = false))
    }
    @Test fun explicitEnabledPreferenceCarriesBoundedVolumeAndOnlyUnlocksOverlay() {
        val preferences = OverlaySoundPreferences.fromScriptResult("""{"enabled":true,"volume":135}""")
        assertEquals(100, preferences.volume)
        assertTrue(preferences.url().endsWith("?mode=overlay&sound=1&volume=100"))
        assertFalse(preferences.requiresGesture(overlay = true))
        assertTrue(preferences.requiresGesture(overlay = false))
        assertEquals(0, OverlaySoundPreferences.fromScriptResult("""{"enabled":true,"volume":-5}""").volume)
    }
    @Test fun javascriptStringEncodingAndMalformedResultsFailSafely() {
        val encoded = JSONObject.quote("""{"enabled":true,"volume":35}""")
        assertEquals(OverlaySoundPreferences(true, 35), OverlaySoundPreferences.fromScriptResult(encoded))
        for (value in listOf(null, "null", "undefined", "invalid")) {
            assertEquals(OverlaySoundPreferences(), OverlaySoundPreferences.fromScriptResult(value))
        }
        assertFalse(OverlaySoundPreferences.fromScriptResult("""{"enabled":"true","volume":"secret"}""").enabled)
    }
    @Test fun readScriptReferencesOnlySoundAndVolumePreferences() {
        val script = OverlaySoundPreferences.READ_SCRIPT
        assertTrue(script.contains("slopgrenade.sound"))
        assertTrue(script.contains("slopgrenade.volume"))
        assertFalse(script.contains("setItem"))
        assertFalse(script.contains("token"))
        assertFalse(script.contains("report"))
    }
}
