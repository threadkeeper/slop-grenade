package com.threadkeeper.slopgrenade.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebView
import android.widget.TextView
import android.view.WindowManager
import org.json.JSONObject
import java.util.concurrent.CompletableFuture

/** Native lifecycle owns explicit overlay consent/start, not its lifetime. Gmail/JNI stays off main. */
class MainActivity : Activity() {
    private lateinit var runtime: MobileRuntime
    private lateinit var router: RequestRouter
    private var dashboard: WebView? = null
    private var pendingOverlay = false
    private var pendingGmailAuthorization = false
    private var awaitingOverlaySettings = false
    private var awaitingNotifications = false
    private var overlayRequestGeneration = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        runtime = MobileRuntime.get(this)
        router = RequestRouter(this, runtime)
        acceptIntent(intent)
        try {
            dashboard = TrustedWebView.create(this, router::dispatch)
            setContentView(dashboard)
        } catch (_: Exception) {
            setContentView(TextView(this).apply { text = "Update Android System WebView, then reopen Slop Grenade." })
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptIntent(intent)
        if (visible) startPendingGmailAuthorization()
    }
    override fun onResume() {
        super.onResume()
        visible = true
        startPendingGmailAuthorization()
        if (pendingOverlay && awaitingOverlaySettings) {
            awaitingOverlaySettings = false
            pendingOverlay = false
            if (Settings.canDrawOverlays(this) && OverlayService.notificationsAllowed(this))
                startOverlayWithPreferences()
        } else if (pendingOverlay && !awaitingNotifications) {
            // A notification result may arrive while stopped; finish consent only after resuming.
            continueOverlayRequest()
        }
        runtime.io.execute {
            try {
                if (runtime.accounts.all().isNotEmpty()) {
                    GmailWorker.schedule(applicationContext)
                    runtime.engine.scanAll() // Session comparison forces quiet rehydrate after process death.
                }
            } catch (_: Exception) { /* Status is exposed through accounts; periodic work can retry. */ }
        }
    }
    private fun acceptIntent(intent: Intent?) {
        if (intent?.action == ACTION_CONNECT_GMAIL) {
            pendingGmailAuthorization = true
            intent.action = null
        }
    }
    private fun startPendingGmailAuthorization() {
        if (!pendingGmailAuthorization || isFinishing || isDestroyed) return
        pendingGmailAuthorization = false
        router.dispatch("POST", "/api/v1/accounts/add", JSONObject())
    }
    override fun onStop() {
        visible = false
        super.onStop()
    }
    fun authorize(email: String?): CompletableFuture<Pair<String, String>> = runtime.google.connect(this, email)
    fun requestOverlay(): JSONObject {
        if (!visible || isFinishing || isDestroyed) return overlayStatus().put("requested", false)
        if (OverlayService.active && Settings.canDrawOverlays(this) && OverlayService.notificationsAllowed(this))
            return overlayStatus().put("requested", false)
        // One permission sequence per explicit dashboard action. Never re-prompt from onResume.
        if (pendingOverlay) return overlayStatus().put("requested", true)
        pendingOverlay = true
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            awaitingNotifications = true
            try {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION)
            } catch (_: Exception) {
                awaitingNotifications = false
                pendingOverlay = false
            }
        } else continueOverlayRequest()
        return overlayStatus().put("requested", pendingOverlay)
    }

    /** Runtime status distinguishes consent from an attached overlay and Android-managed lifetime. */
    fun overlayStatus(): JSONObject = JSONObject()
        .put("overlayGranted", Settings.canDrawOverlays(this))
        .put("notificationsGranted", OverlayService.notificationsAllowed(this))
        .put("overlayActive", OverlayService.active)
        .put("scope", "user-started-foreground-service")
        .put("lifecycle", "Runs across apps until Stop, permission removal, or Android stops it; no automatic restart. Scanning is separate best-effort WorkManager work.")

    /** Explicit dashboard Stop also cancels pending consent and asynchronous preference callbacks. */
    fun stopOverlay(): JSONObject {
        check(visible && !isFinishing && !isDestroyed)
        overlayRequestGeneration++
        pendingOverlay = false
        awaitingOverlaySettings = false
        awaitingNotifications = false
        stopService(Intent(this, OverlayService::class.java))
        return JSONObject().put("ok", true)
    }

    private fun continueOverlayRequest() {
        if (!pendingOverlay || !visible || isFinishing || isDestroyed ||
            !OverlayService.notificationsAllowed(this)) {
            pendingOverlay = false
            return
        }
        val granted = Settings.canDrawOverlays(this)
        if (granted) {
            pendingOverlay = false
            startOverlayWithPreferences()
        }
        else {
            awaitingOverlaySettings = true
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            } catch (_: Exception) {
                awaitingOverlaySettings = false
                pendingOverlay = false
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != NOTIFICATION_PERMISSION || !awaitingNotifications) return
        awaitingNotifications = false
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            if (visible) continueOverlayRequest()
        }
        else pendingOverlay = false
    }
    private fun startOverlayWithPreferences() {
        val generation = ++overlayRequestGeneration
        fun launch(preferences: OverlaySoundPreferences) {
            if (generation != overlayRequestGeneration || !visible || isFinishing || isDestroyed || !Settings.canDrawOverlays(this) ||
                !OverlayService.notificationsAllowed(this)) return
            try {
                startForegroundService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_START)
                    .putExtra("soundEnabled", preferences.enabled).putExtra("soundVolume", preferences.volume))
            } catch (_: Exception) { /* Android can deny startup; dashboard/scanning remain usable. */ }
        }
        val view = dashboard
        if (view == null) { launch(OverlaySoundPreferences()); return }
        try {
            // Read only two non-sensitive preferences from our trusted bundled dashboard.
            view.evaluateJavascript(OverlaySoundPreferences.READ_SCRIPT) {
                launch(OverlaySoundPreferences.fromScriptResult(it))
            }
        } catch (_: Exception) { launch(OverlaySoundPreferences()) }
    }
    @Deprecated("Delegates supported Google consent results")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (!runtime.google.onActivityResult(this, requestCode, resultCode, data))
            super.onActivityResult(requestCode, resultCode, data)
    }
    override fun onDestroy() {
        runtime.google.cancel()
        dashboard?.apply {
            stopLoading()
            androidx.webkit.WebViewCompat.removeWebMessageListener(this, "SlopAndroid")
            clearHistory()
            clearCache(true)
            destroy()
        }
        dashboard = null
        super.onDestroy()
    }
    companion object {
        const val ACTION_CONNECT_GMAIL = "com.threadkeeper.slopgrenade.accounts.CONNECT_GMAIL"
        private const val NOTIFICATION_PERMISSION = 401
        @Volatile var visible = false
            private set
    }
}
