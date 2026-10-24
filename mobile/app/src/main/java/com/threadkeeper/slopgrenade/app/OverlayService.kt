package com.threadkeeper.slopgrenade.app

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.util.concurrent.CompletableFuture

/**
 * Explicitly activated, touch-through prototype. Stops when the Activity stops or task is removed.
 * Not a foreground service: it never claims indefinite dataSync or evades Android 15 time limits.
 */
class OverlayService : Service() {
    private var view: WebView? = null
    private lateinit var windows: WindowManager
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!MainActivity.visible || !Settings.canDrawOverlays(this)) {
            stopSelf(); return START_NOT_STICKY
        }
        val sound = OverlaySoundPreferences(
            intent?.getBooleanExtra("soundEnabled", false) ?: false,
            (intent?.getIntExtra("soundVolume", 70) ?: 70).coerceIn(0, 100))
        view?.let {
            // A subsequent explicit activation reapplies the latest dashboard preferences.
            it.settings.mediaPlaybackRequiresUserGesture = sound.requiresGesture(overlay = true)
            it.loadUrl(sound.url())
            return START_NOT_STICKY
        }
        if (view == null) {
            try {
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
            } catch (_: Exception) { stopSelf() }
        }
        return START_NOT_STICKY
    }
    override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }
    override fun onDestroy() {
        view?.let {
            try { windows.removeView(it) } catch (_: Exception) { /* Already detached. */ }
            WebViewCompat.removeWebMessageListener(it, "SlopAndroid")
            it.stopLoading()
            it.destroy()
        }
        view = null
        super.onDestroy()
    }
}
