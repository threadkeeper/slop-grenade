package com.threadkeeper.slopgrenade.app

import org.json.JSONObject
import org.json.JSONTokener

/** Snapshot of non-sensitive UI preferences, read only when the user activates the overlay. */
data class OverlaySoundPreferences(val enabled: Boolean = false, val volume: Int = 70) {
    fun url(): String = BridgePolicy.ORIGIN + "/index.html?mode=overlay" +
        if (enabled) "&sound=1&volume=${volume.coerceIn(0, 100)}" else ""

    /** Dashboard audio still needs a gesture; only explicit overlay opt-in permits autoplay. */
    fun requiresGesture(overlay: Boolean): Boolean = !overlay || !enabled

    companion object {
        val READ_SCRIPT = """
            (function() {
                try {
                    var stored = localStorage.getItem('slopgrenade.volume');
                    var volume = stored === null ? 70 : Number(stored);
                    return JSON.stringify({
                        enabled: localStorage.getItem('slopgrenade.sound') === 'on',
                        volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 70
                    });
                } catch (_) {
                    return JSON.stringify({enabled: false, volume: 70});
                }
            })()
        """.trimIndent()

        fun fromScriptResult(result: String?): OverlaySoundPreferences {
            if (result == null) return OverlaySoundPreferences()
            return try {
                val value = JSONTokener(result).nextValue()
                val objectValue = when (value) {
                    is JSONObject -> value
                    is String -> JSONObject(value)
                    else -> return OverlaySoundPreferences()
                }
                val number = (objectValue.opt("volume") as? Number)?.toDouble()
                val volume = if (number != null && number.isFinite()) number.coerceIn(0.0, 100.0).toInt() else 70
                OverlaySoundPreferences(objectValue.opt("enabled") == true, volume)
            } catch (_: Exception) { OverlaySoundPreferences() }
        }
    }
}
