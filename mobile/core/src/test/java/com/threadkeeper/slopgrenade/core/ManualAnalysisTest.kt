package com.threadkeeper.slopgrenade.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ManualAnalysisTest {
    private fun judgmentEnvelope(text: String = """{"slopScore":81,"reasoning":"Synthetic reasoning","coachingTip":"Use specifics"}""") =
        JSONObject().put("output", org.json.JSONArray().put(JSONObject().put("content",
            org.json.JSONArray().put(JSONObject().put("text", "```json\n$text\n```")))))
    private fun auth(api: ManualAnalysis, token: Any = "synthetic-test-credential-not-real") =
        api.request("POST", "/api/v1/auth/github-token", JSONObject().put("token", token))

    @Test fun tokenIsMemoryOnlyAndStatusNeverEchoesIt() {
        val api = ManualAnalysis(CoreApi { error("Native must not receive credentials") }, LunaClient { _, _ -> error("No automatic requests") })
        val result = auth(api)
        assertEquals(200, result.getInt("status"))
        val status = result.getJSONObject("body").getJSONObject("githubLuna")
        assertTrue(status.getBoolean("authenticated"))
        assertFalse(result.toString().contains("synthetic-test-credential"))
        assertFalse(ManualAnalysis(CoreApi { error("Unused") }, LunaClient { _, _ -> error("Unused") })
            .request("GET", "/api/v1/auth/status", JSONObject()).getJSONObject("body")
            .getJSONObject("githubLuna").getBoolean("authenticated"))
        auth(api, JSONObject.NULL)
        assertFalse(api.request("GET", "/api/v1/auth/status", JSONObject()).getJSONObject("body")
            .getJSONObject("githubLuna").getBoolean("authenticated"))
    }

    @Test fun explicitLunaRequestUsesFixedModelAndPreservesAnalyzeFlagsAndEnvelope() {
        var posted: JSONObject? = null
        var forwarded: JSONObject? = null
        val api = ManualAnalysis(CoreApi {
            forwarded = JSONObject(it)
            """{"status":200,"body":{"report":{"lunaScore":81},"event":null}}"""
        }, LunaClient { token, body ->
            assertEquals("synthetic-test-credential-not-real", token)
            posted = body
            judgmentEnvelope()
        })
        auth(api)
        val response = api.request("POST", "/api/v1/analyze", JSONObject().put("body", "Synthetic draft")
            .put("useLuna", true).put("recordInLedger", false).put("triggerAnimation", false))
        assertEquals(200, response.getInt("status"))
        assertTrue(response.getJSONObject("body").isNull("event"))
        assertEquals(81, response.getJSONObject("body").getJSONObject("report").getInt("lunaScore"))
        assertEquals("gpt-5.6-luna", posted!!.getString("model"))
        val body = forwarded!!.getJSONObject("body")
        assertFalse(body.getBoolean("recordInLedger"))
        assertFalse(body.getBoolean("triggerAnimation"))
        assertEquals(81, body.getJSONObject("lunaJudgment").getInt("slopScore"))
        assertFalse(forwarded.toString().contains("synthetic-test-credential"))
    }

    @Test fun deterministicAndSimulationRequestsNeverCallLuna() {
        val forwarded = mutableListOf<JSONObject>()
        val api = ManualAnalysis(CoreApi {
            forwarded.add(JSONObject(it)); """{"status":200,"body":{"report":{},"event":null}}"""
        }, LunaClient { _, _ -> error("No implicit external submission") })
        auth(api)
        api.request("POST", "/api/v1/analyze", JSONObject().put("body", "Synthetic draft")
            .put("lunaJudgment", JSONObject().put("slopScore", 100)))
        assertFalse(forwarded.single().getJSONObject("body").has("lunaJudgment"))
        api.request("POST", "/api/v1/simulate", JSONObject().put("preset", "human_sparkle"))
        assertEquals("human_sparkle", forwarded.last().getJSONObject("body").getString("preset"))
        assertEquals("/api/v1/simulate", forwarded.last().getString("path"))
    }

    @Test fun missingDisabledMalformedOrFailedLunaIsExplicitAndDoesNotRecord() {
        var calls = 0
        val core = CoreApi { calls++; error("Failed Luna must not mutate core") }
        val api = ManualAnalysis(core, LunaClient { _, _ -> throw LunaClient.Unavailable() })
        val body = JSONObject().put("body", "Synthetic draft").put("useLuna", true)
        assertEquals(503, api.request("POST", "/api/v1/analyze", body).getInt("status"))
        auth(api)
        assertEquals(503, api.request("POST", "/api/v1/analyze", body).getInt("status"))
        api.request("POST", "/api/v1/auth/github-token", JSONObject().put("enabled", false))
        assertEquals(503, api.request("POST", "/api/v1/analyze", body).getInt("status"))
        val malformed = ManualAnalysis(core, LunaClient { _, _ -> judgmentEnvelope("""{"slopScore":"not a score"}""") })
        auth(malformed)
        assertEquals(503, malformed.request("POST", "/api/v1/analyze", body).getInt("status"))
        assertEquals(0, calls)
    }

    @Test fun validatesBeforeNetworkAndRejectsImplicitBooleanCoercion() {
        var calls = 0
        val api = ManualAnalysis(CoreApi { error("Invalid request") }, LunaClient { _, _ -> calls++; judgmentEnvelope() })
        auth(api)
        assertEquals(400, api.request("POST", "/api/v1/analyze",
            JSONObject().put("body", "Synthetic").put("useLuna", "true")).getInt("status"))
        assertEquals(400, api.request("POST", "/api/v1/analyze",
            JSONObject().put("body", "").put("useLuna", true)).getInt("status"))
        assertEquals(400, api.request("POST", "/api/v1/auth/github-token",
            JSONObject().put("token", "synthetic\ncredential")).getInt("status"))
        assertEquals(0, calls)
    }
}
