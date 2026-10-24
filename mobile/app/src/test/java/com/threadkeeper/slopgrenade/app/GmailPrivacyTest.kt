package com.threadkeeper.slopgrenade.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GmailPrivacyTest {
    private fun sample(direction: String = "received") = JSONObject().put("messageId", "one:id")
        .put("sender", "Synthetic Person <synthetic@example.invalid>").put("subjectOrTopic", "Synthetic private subject")
        .put("direction", direction).put("body", "Ephemeral synthetic body").put("app", "gmail")
    @Test fun metadataIsPseudonymizedBeforeCoreWithoutChangingEphemeralBody() {
        val raw = sample()
        val output = GmailPrivacy.redact("one", JSONArray().put(raw)).getJSONObject(0)
        assertTrue(output.getString("sender").startsWith("Gmail correspondent "))
        assertEquals("Gmail message", output.getString("subjectOrTopic"))
        assertEquals("Ephemeral synthetic body", output.getString("body"))
        assertEquals("one:id", output.getString("messageId"))
        assertFalse(output.toString().contains("synthetic@example.invalid"))
        assertFalse(output.toString().contains("Synthetic private subject"))
        assertEquals("Synthetic private subject", raw.getString("subjectOrTopic"))
    }
    @Test fun pseudonymsAreStableAccountScopedAndSentIdentityIsGeneric() {
        fun sender(account: String) = GmailPrivacy.redact(account, JSONArray().put(sample())).getJSONObject(0).getString("sender")
        assertEquals(sender("one"), sender("one"))
        assertNotEquals(sender("one"), sender("two"))
        assertEquals("You (Gmail)", GmailPrivacy.redact("one", JSONArray().put(sample("sent"))).getJSONObject(0).getString("sender"))
    }
}
