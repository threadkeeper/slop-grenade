package com.threadkeeper.slopgrenade.core

import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject

class CoreApiTest {
    @Test fun forwardsExactEnvelope() {
        var input = ""
        val api = CoreApi { input = it; """{"status":200,"body":{"ok":true}}""" }
        api.checked("POST", "/internal/ingest", JSONObject().put("quiet", true))
        val request = JSONObject(input)
        assertEquals("/internal/ingest", request.getString("path"))
        assertTrue(request.getJSONObject("body").getBoolean("quiet"))
    }
    @Test(expected = IllegalStateException::class) fun nonSuccessDoesNotCommit() {
        CoreApi { """{"status":503,"body":{}}""" }.checked("GET", "/internal/session")
    }
}
