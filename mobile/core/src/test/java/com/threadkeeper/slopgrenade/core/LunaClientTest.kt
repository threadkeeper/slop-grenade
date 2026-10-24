package com.threadkeeper.slopgrenade.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class LunaClientTest {
    @Test fun transportUsesBearerHeadersWithoutRedirects() {
        val connection = object : java.net.HttpURLConnection(java.net.URL(LunaClient.ENDPOINT)) {
            override fun connect() { error("Unit test must not connect") }
            override fun disconnect() {}
            override fun usingProxy() = false
        }
        LunaClient.configure(connection, "synthetic-not-real")
        assertEquals("Bearer " + "synthetic-not-real", connection.getRequestProperty("Authorization"))
        assertEquals("POST", connection.requestMethod)
        assertFalse(connection.instanceFollowRedirects)
        assertFalse(connection.useCaches)
        assertEquals("no-store", connection.getRequestProperty("Cache-Control"))
        assertEquals("application/json", connection.getRequestProperty("Content-Type"))
    }
    @Test fun parsesSplitOutputAndCompatibleChoicesWithBoundedFields() {
        val envelope = JSONObject().put("output", JSONArray().put(JSONObject().put("content", JSONArray()
            .put(JSONObject().put("text", """{"slopScore":72,"reasoning":"synthetic","""))
            .put(JSONObject().put("text", """"coachingTip":"Be specific"}""")))))
        val parsed = LunaClient.parse(envelope)
        assertEquals(72, parsed.getInt("slopScore"))
        assertEquals(LunaClient.MODEL, parsed.getString("model"))
        val choices = JSONObject().put("choices", JSONArray().put(JSONObject().put("message", JSONObject()
            .put("content", """{"slop_score":20,"reasoning":"${"x".repeat(300)}","coaching_tip":"${"y".repeat(300)}"}"""))))
        val compatible = LunaClient.parse(choices)
        assertEquals(20, compatible.getInt("slopScore"))
        assertEquals(120, compatible.getString("reasoning").length)
        assertEquals(160, compatible.getString("coachingTip").length)
    }
    @Test fun rejectsOutOfRangeFractionalMissingAndEmptyOutput() {
        listOf("""{"slopScore":101}""", """{"slopScore":-1}""", """{"slopScore":2.5}""", """{}""", "")
            .forEach { text ->
                try {
                    LunaClient.parse(JSONObject().put("output_text", text))
                    fail("Invalid judgment accepted")
                } catch (_: LunaClient.Unavailable) { }
            }
    }
    @Test fun promptIsBoundedAndOnlyContainsExplicitDraftFields() {
        var prompt = ""
        val client = LunaClient { _, request ->
            prompt = request.getString("input")
            JSONObject().put("output_text", """{"slopScore":10}""")
        }
        client.evaluate("synthetic-not-real", JSONObject().put("body", "x".repeat(5000))
            .put("subjectOrTopic", "Explicit subject").put("sender", "must-not-transmit@example.invalid"))
        assertTrue(prompt.contains("Explicit subject"))
        assertFalse(prompt.contains("must-not-transmit"))
        assertFalse(prompt.contains("x".repeat(1801)))
        assertEquals("https://api.githubcopilot.com/responses", LunaClient.ENDPOINT)
    }
}
