package com.threadkeeper.slopgrenade.core

import org.json.JSONObject

/**
 * Manual-only optional Luna boundary. No scanner/worker references this object.
 * A token never goes to JNI, preferences, files, URLs, status responses, or logs.
 */
class ManualAnalysis(private val core: CoreApi, private val luna: LunaClient = LunaClient()) {
    private class Session(val token: String?, val enabled: Boolean)
    @Volatile private var session = Session(null, true)

    fun request(method: String, path: String, body: JSONObject): JSONObject = try {
        when {
            method == "POST" && path == "/api/v1/auth/github-token" -> update(body)
            method == "GET" && path == "/api/v1/auth/status" -> response(200, status())
            method == "POST" && path == "/api/v1/analyze" -> analyze(body)
            // Shared Rust presets remain authoritative; no fabricated tiers or scores in Kotlin.
            method == "POST" && path == "/api/v1/simulate" -> core.request(method, path, body)
            else -> response(404, JSONObject().put("error", "Manual route unavailable"))
        }
    } catch (_: LunaClient.Unavailable) {
        response(503, JSONObject().put("error", "Explicit GPT Luna evaluation unavailable; no analysis was recorded")
            .put("useLuna", true))
    } catch (_: IllegalArgumentException) {
        response(400, JSONObject().put("error", "Invalid manual analysis or credential request"))
    }

    @Synchronized private fun update(body: JSONObject): JSONObject {
        val previous = session
        if (body.has("enabled")) require(body.opt("enabled") is Boolean)
        val enabled = if (body.has("enabled")) body.getBoolean("enabled") else previous.enabled
        val token = if (!body.has("token")) previous.token else {
            val value = body.opt("token")
            require(value === JSONObject.NULL || value is String)
            val trimmed = (value as? String)?.trim()?.takeIf { it.isNotEmpty() }
            require(trimmed == null || (trimmed.length <= 8192 && trimmed.all { it.code in 33..126 }))
            trimmed
        }
        session = Session(token, enabled)
        return response(200, status())
    }

    private fun analyze(input: JSONObject): JSONObject = core.communicationTransaction {
        for (key in listOf("useLuna", "recordInLedger", "triggerAnimation"))
            if (input.has(key)) require(input.opt(key) is Boolean)
        require(input.opt("body") is String && input.getString("body").isNotBlank())
        require(!input.has("app") || input.opt("app") in setOf("teams", "outlook", "gmail"))
        require(!input.has("direction") || input.opt("direction") in setOf("sent", "received"))
        for (key in listOf("sender", "subjectOrTopic")) if (input.has(key)) require(input.opt(key) is String)
        val body = JSONObject(input.toString())
        body.remove("lunaJudgment") // Only a validated response from this explicit request may supply it.
        if (body.optBoolean("useLuna", false)) {
            val current = session
            if (!current.enabled || current.token == null) throw LunaClient.Unavailable()
            body.put("lunaJudgment", luna.evaluate(current.token, body))
        }
        // Preserve recordInLedger/triggerAnimation and return the core's exact {report,event} envelope.
        core.request("POST", "/api/v1/analyze", body)
    }

    private fun status(): JSONObject {
        val current = session
        val github = JSONObject().put("authenticated", current.token != null)
            .put("tokenSource", if (current.token == null) "none" else "session")
            .put("githubLogin", JSONObject.NULL).put("model", LunaClient.MODEL).put("endpoint", LunaClient.ENDPOINT)
            .put("enabled", current.enabled).put("message",
                if (current.token == null) "No in-memory GitHub credential; explicit Luna analysis unavailable."
                else "Session credential present, not pre-verified. Only explicit draft requests may use Luna.")
        return JSONObject().put("adminAppRequired", false).put("githubLuna", github)
            .put("workiq", JSONObject().put("installed", false).put("authenticated", false)
                .put("message", "WorkIQ is unavailable on Android; connect Gmail accounts instead."))
    }
    private fun response(status: Int, body: JSONObject) = JSONObject().put("status", status).put("body", body)
}
