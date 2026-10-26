package com.threadkeeper.slopgrenade.app

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.provider.Settings
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.After
import org.junit.Before
import org.junit.Assume.assumeFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Run on API 30 and API 34+; permission-granted cases need overlay/notification consent. */
@RunWith(AndroidJUnit4::class)
class OverlayLifecycleTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Before fun resetOverlay() {
        context.stopService(Intent(context, OverlayService::class.java))
        instrumentation.waitForIdleSync()
    }

    @After fun stopOverlay() {
        context.stopService(Intent(context, OverlayService::class.java))
        instrumentation.waitForIdleSync()
    }

    @Test fun manifestDeclaresPrivateSpecialUseServiceAndExplicitPermissions() {
        val service = context.packageManager.getServiceInfo(ComponentName(context, OverlayService::class.java), 0)
        assertFalse(service.exported)
        assertEquals(0, service.flags and ServiceInfo.FLAG_STOP_WITH_TASK)
        val permissions = context.packageManager.getPackageInfo(
            context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        assertTrue(permissions.contains(Manifest.permission.FOREGROUND_SERVICE))
        assertTrue(permissions.contains("android.permission.FOREGROUND_SERVICE_SPECIAL_USE"))
        assertTrue(permissions.contains("android.permission.POST_NOTIFICATIONS"))
        if (Build.VERSION.SDK_INT >= 34) {
            assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE, service.foregroundServiceType)
            val subtype = context.packageManager.getProperty(
                "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE", ComponentName(context, OverlayService::class.java))
            assertTrue(subtype.string.contains("user-started", ignoreCase = true))
            assertTrue(subtype.string.contains("screen-edge"))
        }
    }

    @Test fun deniedOverlayCannotActivateServiceOrBreakDashboard() {
        assumeFalse("Run with draw-over-other-apps denied", Settings.canDrawOverlays(context))
        val activity = openDashboard()
        try {
            instrumentation.runOnMainSync {
                context.startService(Intent(context, OverlayService::class.java).setAction(OverlayService.ACTION_START))
            }
            instrumentation.waitForIdleSync()
            assertFalse(OverlayService.active)
            assertFalse(activity.isFinishing)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun explicitOverlaySurvivesDashboardClosureAndStopActionRemovesIt() {
        org.junit.Assume.assumeTrue("Grant overlay permission for this case", Settings.canDrawOverlays(context))
        org.junit.Assume.assumeTrue("Grant notifications for this case", OverlayService.notificationsAllowed(context))
        val activity = openDashboard()
        try {
            instrumentation.runOnMainSync {
                activity.startForegroundService(Intent(activity, OverlayService::class.java)
                    .setAction(OverlayService.ACTION_START))
            }
            instrumentation.waitForIdleSync()
            assertTrue(OverlayService.active)
            val notification = context.getSystemService(NotificationManager::class.java)
                .activeNotifications.single { it.id == OverlayService.NOTIFICATION_ID }.notification
            assertNotNull(notification.contentIntent)
            val stop = notification.actions.single()
            assertEquals("Stop", stop.title.toString())
            if (Build.VERSION.SDK_INT >= 31) {
                assertTrue(notification.contentIntent.isImmutable)
                assertTrue(stop.actionIntent.isImmutable)
            }
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.waitForIdleSync()
            assertFalse(MainActivity.visible)
            assertTrue(OverlayService.active)
            stop.actionIntent.send()
            waitUntilStopped()
            assertFalse(OverlayService.active)
            assertFalse(context.getSystemService(NotificationManager::class.java)
                .activeNotifications.any { it.id == OverlayService.NOTIFICATION_ID })
        } finally {
            context.stopService(Intent(context, OverlayService::class.java))
            instrumentation.runOnMainSync { if (!activity.isFinishing) activity.finish() }
        }
    }

    @Test fun stopActionIsSafeWithoutActivationOrPermissions() {
        val activity = openDashboard()
        try {
            instrumentation.runOnMainSync {
                context.startService(Intent(context, OverlayService::class.java).setAction(OverlayService.ACTION_STOP))
            }
            waitUntilStopped()
            assertFalse(OverlayService.active)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun dashboardStatusReportsManagedLifecycleWithoutStartingEffects() {
        context.stopService(Intent(context, OverlayService::class.java))
        instrumentation.waitForIdleSync()
        val activity = openDashboard()
        try {
            instrumentation.runOnMainSync {
                val status = activity.overlayStatus()
                assertEquals("user-started-foreground-service", status.getString("scope"))
                assertEquals(Settings.canDrawOverlays(context), status.getBoolean("overlayGranted"))
                assertEquals(OverlayService.notificationsAllowed(context), status.getBoolean("notificationsGranted"))
                assertFalse(status.getBoolean("overlayActive"))
                assertTrue(status.getString("lifecycle").contains("no automatic restart"))
                // A missing/null start action must not turn opening the dashboard into an autostart.
                context.startService(Intent(context, OverlayService::class.java))
            }
            instrumentation.waitForIdleSync()
            assertFalse(OverlayService.active)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun deniedNotificationsCannotActivateEffectsOrBreakDashboard() {
        org.junit.Assume.assumeTrue("Grant overlay permission to isolate notification denial",
            Settings.canDrawOverlays(context))
        assumeFalse("Deny notifications for this case", OverlayService.notificationsAllowed(context))
        val activity = openDashboard()
        try {
            instrumentation.runOnMainSync {
                context.startService(Intent(context, OverlayService::class.java).setAction(OverlayService.ACTION_START))
            }
            instrumentation.waitForIdleSync()
            assertFalse(OverlayService.active)
            assertFalse(activity.isFinishing)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    /**
     * Preconfigure only a dedicated test device: allow app notifications/overlay, then block the
     * screen-edge-effects channel in system settings. Read-only: never creates, blocks, deletes,
     * or recreates a channel, since Android may retain user blocks even after channel deletion.
     */
    @Test fun globallyEnabledNotificationsWithBlockedEffectsChannelCannotStartOverlay() {
        val notifications = context.getSystemService(NotificationManager::class.java)
        org.junit.Assume.assumeTrue("Enable app notifications", notifications.areNotificationsEnabled())
        if (Build.VERSION.SDK_INT >= 33)
            org.junit.Assume.assumeTrue("Grant notification permission",
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        org.junit.Assume.assumeTrue("Grant overlay permission", Settings.canDrawOverlays(context))
        val channel = notifications.getNotificationChannel("screen-edge-effects")
        org.junit.Assume.assumeTrue("Preconfigure the blocked effects channel on a test device",
            channel?.importance == NotificationManager.IMPORTANCE_NONE)
        assertFalse(OverlayService.notificationsAllowed(context))
        val activity = openDashboard()
        try {
            val router = RequestRouter(activity, MobileRuntime.get(context))
            val accounts = router.dispatch("GET", "/api/v1/accounts", JSONObject()).get(5, TimeUnit.SECONDS)
            assertFalse(accounts.getJSONObject("body").getBoolean("notificationsGranted"))
            val requested = router.dispatch("POST", "/api/v1/overlay/permission", JSONObject()).get(5, TimeUnit.SECONDS)
            assertFalse(requested.getJSONObject("body").getBoolean("notificationsGranted"))
            instrumentation.runOnMainSync {
                context.startService(Intent(context, OverlayService::class.java).setAction(OverlayService.ACTION_START))
            }
            waitUntilStopped()
            assertFalse(OverlayService.active)
            assertFalse(activity.isFinishing)
            val stopped = router.dispatch("POST", "/api/v1/overlay/stop", JSONObject()).get(5, TimeUnit.SECONDS)
            assertTrue(stopped.getJSONObject("body").getBoolean("ok"))
            assertEquals(NotificationManager.IMPORTANCE_NONE,
                notifications.getNotificationChannel("screen-edge-effects").importance)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun dashboardStopRouteIsIdempotentWithoutOverlayConsent() {
        val activity = openDashboard()
        try {
            val router = RequestRouter(activity, MobileRuntime.get(context))
            repeat(2) {
                val stopped = router.dispatch("POST", "/api/v1/overlay/stop", JSONObject()).get(5, TimeUnit.SECONDS)
                assertEquals(200, stopped.getInt("status"))
                assertTrue(stopped.getJSONObject("body").getBoolean("ok"))
            }
            waitUntilStopped()
            val accounts = router.dispatch("GET", "/api/v1/accounts", JSONObject()).get(5, TimeUnit.SECONDS)
            assertFalse(accounts.getJSONObject("body").getBoolean("overlayActive"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun dashboardRoutesReportEventuallyActiveAndAllowExplicitStop() {
        org.junit.Assume.assumeTrue("Grant overlay permission for this case", Settings.canDrawOverlays(context))
        org.junit.Assume.assumeTrue("Grant notifications for this case", OverlayService.notificationsAllowed(context))
        val activity = openDashboard()
        try {
            val router = RequestRouter(activity, MobileRuntime.get(context))
            repeat(2) {
                val started = router.dispatch("POST", "/api/v1/overlay/permission", JSONObject()).get(5, TimeUnit.SECONDS)
                assertEquals(200, started.getInt("status"))
            }
            var active = false
            for (attempt in 0 until 100) {
                val accounts = router.dispatch("GET", "/api/v1/accounts", JSONObject()).get(5, TimeUnit.SECONDS)
                if (accounts.getJSONObject("body").getBoolean("overlayActive")) {
                    active = true
                    break
                }
                Thread.sleep(50)
            }
            assertTrue("Async start must eventually be reflected in accounts polling", active)
            assertEquals(1, context.getSystemService(NotificationManager::class.java)
                .activeNotifications.count { it.id == OverlayService.NOTIFICATION_ID })
            val stopped = router.dispatch("POST", "/api/v1/overlay/stop", JSONObject()).get(5, TimeUnit.SECONDS)
            assertTrue(stopped.getJSONObject("body").getBoolean("ok"))
            waitUntilStopped()
            val accounts = router.dispatch("GET", "/api/v1/accounts", JSONObject()).get(5, TimeUnit.SECONDS)
            assertFalse(accounts.getJSONObject("body").getBoolean("overlayActive"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun stopCancelsAsyncActivationBeforePreferencesReturn() {
        org.junit.Assume.assumeTrue("Grant overlay permission for this case", Settings.canDrawOverlays(context))
        org.junit.Assume.assumeTrue("Grant notifications for this case", OverlayService.notificationsAllowed(context))
        val activity = openDashboard()
        try {
            instrumentation.runOnMainSync {
                activity.requestOverlay()
                assertTrue(activity.stopOverlay().getBoolean("ok"))
            }
            // Let any asynchronous WebView callback run after Stop; it must not restart effects.
            Thread.sleep(500)
            instrumentation.waitForIdleSync()
            assertFalse(OverlayService.active)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    private fun openDashboard() = instrumentation.startActivitySync(
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity

    @Suppress("DEPRECATION")
    private fun waitUntilStopped() {
        repeat(100) {
            instrumentation.waitForIdleSync()
            if (context.getSystemService(ActivityManager::class.java).getRunningServices(Int.MAX_VALUE)
                    .none { it.service.className == OverlayService::class.java.name }) return
            Thread.sleep(50)
        }
        fail("Overlay service did not stop")
    }
}
