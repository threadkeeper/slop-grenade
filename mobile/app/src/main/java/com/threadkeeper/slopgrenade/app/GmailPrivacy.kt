package com.threadkeeper.slopgrenade.app

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale

/** Metadata privacy boundary before JNI; raw bodies exist only for ephemeral deterministic scoring. */
object GmailPrivacy {
    fun redact(accountId: String, samples: JSONArray): JSONArray = JSONArray().also { output ->
        for (index in 0 until samples.length()) {
            val sample = JSONObject(samples.getJSONObject(index).toString())
            val sender = if (sample.optString("direction") == "sent") "You (Gmail)" else {
                val identity = accountId + "\u0000" + sample.optString("sender").trim().lowercase(Locale.ROOT)
                val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
                    .take(8).joinToString("") { "%02x".format(it) }
                "Gmail correspondent $digest"
            }
            output.put(sample.put("sender", sender).put("subjectOrTopic", "Gmail message"))
        }
    }
}
