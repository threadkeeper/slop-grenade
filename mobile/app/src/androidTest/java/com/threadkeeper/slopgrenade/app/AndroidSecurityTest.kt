package com.threadkeeper.slopgrenade.app

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CompletableFuture
import org.json.JSONObject
import com.threadkeeper.slopgrenade.gmail.GmailClient

@RunWith(AndroidJUnit4::class)
class AndroidSecurityTest {
    /** Run on an API-30 device to catch linkage that host JVM tests cannot detect. */
    @Test fun connectorAndBatchExecuteWithoutApi33OrRecordRuntime() {
        val end = 1_700_604_800_999L
        val transport = GmailClient.Transport { path ->
            when {
                path == "/profile" -> JSONObject("""{"historyId":"42"}""")
                path.startsWith(GmailClient.FULL) -> JSONObject("""{"messages":[{"id":"synthetic"}]}""")
                path == "/messages/synthetic?format=full" -> JSONObject(
                    """{"id":"synthetic","internalDate":"${end - 1}","labelIds":["SENT"],"payload":{"mimeType":"text/plain","body":{"data":"SGVsbG8"}}}""")
                else -> error("Unexpected synthetic transport path")
            }
        }
        val client = GmailClient(transport, { }, java.time.Clock.fixed(
            java.time.Instant.ofEpochMilli(end), java.time.ZoneOffset.UTC))
        val batch = client.scan("synthetic-account", null)
        assertEquals(Any::class.java, GmailClient.Batch::class.java.superclass)
        assertEquals("Hello", batch.samples().getJSONObject(0).getString("body"))
        assertEquals("sent", batch.samples().getJSONObject(0).getString("direction"))
    }
    @Test fun backupAndExportSurfaceAreClosed() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
        val service = context.packageManager.getServiceInfo(
            android.content.ComponentName(context, OverlayService::class.java), 0)
        assertFalse(service.exported)
        assertFalse(BridgePolicy.trusted("https://example.invalid", true))
    }

    @Test fun webViewAllowsTrustedPreferencesButRejectsFileContentMixedContentAndSavedViewState() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val view = TrustedWebView.create(instrumentation.targetContext, { _, _, _ ->
                CompletableFuture.completedFuture(JSONObject().put("status", 200).put("body", JSONObject()))
            })
            try {
                assertFalse(view.settings.allowFileAccess)
                assertFalse(view.settings.allowContentAccess)
                assertTrue(view.settings.domStorageEnabled)
                assertFalse(view.isSaveEnabled)
                assertEquals(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, view.importantForAutofill)
                assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW, view.settings.mixedContentMode)
            } finally { view.destroy() }
        }
    }

    @Test fun dashboardCanFinishAndDeniedOverlayDoesNotRequestForegroundService() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        instrumentation.runOnMainSync { activity.finish() }
        instrumentation.waitForIdleSync()
        assertFalse(MainActivity.visible)
        // Permission denial is independent of Gmail scan scheduling; no service permission is needed.
        assertFalse(context.packageManager.getPackageInfo(context.packageName,
            android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
            .contains("android.permission.FOREGROUND_SERVICE"))
    }
}
