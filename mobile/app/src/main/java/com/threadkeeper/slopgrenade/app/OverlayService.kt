package com.threadkeeper.slopgrenade.app

import android.Manifest
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import com.threadkeeper.slopgrenade.R
import org.json.JSONObject
import java.util.concurrent.CompletableFuture

/**
 * User-started, touch-through visual effects, independent of the dashboard and Gmail WorkManager.
 * No restart/boot recovery: Android may stop this service; the user must explicitly enable it again.
 */
class OverlayService : Service() {
    private var view: WebView? = null
    private lateinit var windows: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private var permissionWatcher: AppOpsManager.OnOpChangedListener? = null
    private var notificationReceiverRegistered = false
    private val notificationPermissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            // Android broadcasts app/channel blocking changes; no polling or scanner coupling.
            if (!notificationsAllowed(this@OverlayService)) stopOverlay()
        }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopOverlay()
            return START_NOT_STICKY
        }
        // Only an explicit action while the dashboard is visible may initially activate effects.
        // Already-running effects do not depend on Activity visibility.
        if (intent?.action != ACTION_START || (!active && !MainActivity.visible) ||
            !Settings.canDrawOverlays(this) || !notificationsAllowed(this)) {
            stopOverlay()
            return START_NOT_STICKY
        }
        try {
            // Meet the foreground deadline before creating a WebView or initializing the runtime.
            val notification = notification()
            if (Build.VERSION.SDK_INT >= 34)
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(NOTIFICATION_ID, notification)
        } catch (_: Exception) {
            stopOverlay()
            return START_NOT_STICKY
        }
        val sound = OverlaySoundPreferences(
            intent?.getBooleanExtra("soundEnabled", false) ?: false,
            (intent?.getIntExtra("soundVolume", 70) ?: 70).coerceIn(0, 100))
        view?.let {
            // A subsequent explicit activation reapplies the latest dashboard preferences.
            try {
                it.settings.mediaPlaybackRequiresUserGesture = sound.requiresGesture(overlay = true)
                it.loadUrl(sound.url())
            } catch (_: Exception) { stopOverlay() }
            return START_NOT_STICKY
        }
        if (view == null) {
            try {
                if (!notificationReceiverRegistered) {
                    val filter = IntentFilter(NotificationManager.ACTION_NOTIFICATION_CHANNEL_BLOCK_STATE_CHANGED)
                        .apply { addAction(NotificationManager.ACTION_APP_BLOCK_STATE_CHANGED) }
                    if (Build.VERSION.SDK_INT >= 33)
                        registerReceiver(notificationPermissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
                    else registerReceiver(notificationPermissionReceiver, filter)
                    notificationReceiverRegistered = true
                }
                if (permissionWatcher == null) {
                    val watcher = AppOpsManager.OnOpChangedListener { op, changedPackage ->
                        if (op == AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW && changedPackage == packageName)
                            main.post { if (!Settings.canDrawOverlays(this)) stopOverlay() }
                    }
                    permissionWatcher = watcher
                    getSystemService(AppOpsManager::class.java).startWatchingMode(
                        AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, packageName, watcher)
                }
                windows = getSystemService(WindowManager::class.java)
                val runtime = MobileRuntime.get(this)
                val webView = TrustedWebView.create(this, { method, path, body ->
                    CompletableFuture.supplyAsync({
                        if (method == "GET" && BridgePolicy.nativeAllowed(method, path))
                            runtime.core.request(method, path, body)
                        else JSONObject().put("status", 403).put("body", JSONObject().put("error", "Read-only overlay"))
                    }, runtime.io)
                }, overlay = true, overlaySound = sound)
                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_SECURE,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.TOP or Gravity.START
                    // Android 12+ touch-through requires opacity below the system obscuring threshold.
                    alpha = 0.65f
                }
                view = webView
                windows.addView(webView, params)
                // Recheck after attaching in case consent changed during startup.
                if (Settings.canDrawOverlays(this) && notificationsAllowed(this)) active = true else stopOverlay()
            } catch (_: Exception) { stopOverlay() }
        }
        return START_NOT_STICKY
    }
    private fun notification(): Notification {
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(
            CHANNEL_ID, "Screen-edge effects", NotificationManager.IMPORTANCE_LOW))
        val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), immutable)
        val connectGmail = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java)
            .setAction(MainActivity.ACTION_CONNECT_GMAIL)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), immutable)
        val stop = PendingIntent.getService(this, 1,
            Intent(this, OverlayService::class.java).setAction(ACTION_STOP), immutable)
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Slop Grenade screen-edge effects")
            .setContentText("Effects remain on across apps. Connect Gmail or tap Stop.")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Connect Gmail", connectGmail).build())
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .setOngoing(true).setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
        if (Build.VERSION.SDK_INT >= 31)
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return builder.build()
    }

    private fun stopOverlay() {
        releaseOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun releaseOverlay() {
        active = false
        if (notificationReceiverRegistered) {
            try { unregisterReceiver(notificationPermissionReceiver) }
            catch (_: Exception) { /* Receiver may already be detached during system teardown. */ }
            notificationReceiverRegistered = false
        }
        permissionWatcher?.let {
            try { getSystemService(AppOpsManager::class.java).stopWatchingMode(it) }
            catch (_: Exception) { /* Still release the window if the system service is unavailable. */ }
        }
        permissionWatcher = null
        main.removeCallbacksAndMessages(null)
        view?.let {
            try { windows.removeView(it) } catch (_: Exception) { /* Already detached. */ }
            try {
                WebViewCompat.removeWebMessageListener(it, "SlopAndroid")
                it.stopLoading()
                it.destroy()
            } catch (_: Exception) { /* Continue cleanup even if WebView has failed. */ }
        }
        view = null
    }

    override fun onDestroy() {
        releaseOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.threadkeeper.slopgrenade.overlay.START"
        const val ACTION_STOP = "com.threadkeeper.slopgrenade.overlay.STOP"
        const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "screen-edge-effects"

        /** Process-local attached-view status, not a promise Android will keep the service alive. */
        @Volatile var active = false
            private set

        /** Both app and effects-channel consent are required; an absent channel is created on start. */
        fun notificationsAllowed(context: Context): Boolean {
            if (Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                return false
            val notifications = context.getSystemService(NotificationManager::class.java)
            return notifications.areNotificationsEnabled() &&
                notifications.getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE
        }
    }
}
