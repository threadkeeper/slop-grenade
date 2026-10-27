package com.threadkeeper.slopgrenade.core

import org.json.JSONObject

/** Injectable request facade allows tests without loading the production native library. */
class CoreApi(private val transport: (String) -> String = NativeCore::request) {
    private val communicationLock = Any()

    /** Keep in-flight analysis and its final native commit ahead of any subsequent wipe. */
    fun <T> communicationTransaction(action: () -> T): T = synchronized(communicationLock) { action() }

    fun request(method: String, path: String, body: Any? = null): JSONObject = communicationTransaction {
        val response = JSONObject(transport(JSONObject().put("method", method).put("path", path)
            .put("body", body ?: JSONObject.NULL).toString()))
        require(response.has("status") && response.has("body")) { "Invalid native response" }
        response
    }

    fun checked(method: String, path: String, body: Any? = null): Any {
        val response = request(method, path, body)
        check(response.getInt("status") in 200..299) { "Native request failed" }
        return response.get("body")
    }
}
