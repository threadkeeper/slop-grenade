package com.threadkeeper.slopgrenade.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebView
import android.widget.TextView
import android.view.WindowManager
import org.json.JSONObject
import java.util.concurrent.CompletableFuture

/** Native lifecycle owns consent and the visible-app-only overlay. All Gmail/JNI work stays off main. */
class MainActivity : Activity() {
    private lateinit var runtime: MobileRuntime
    private var dashboard: WebView? = null
    private var pendingOverlay = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        runtime = MobileRuntime.get(this)
        try {
            dashboard = TrustedWebView.create(this, RequestRouter(this, runtime)::dispatch)
            setContentView(dashboard)
        } catch (_: Exception) {
            setContentView(TextView(this).apply { text = "Update Android System WebView, then reopen Slop Grenade." })
        }
    }
    override fun onResume() {
        super.onResume()
        visible = true
        if (pendingOverlay) {
            pendingOverlay = false
            if (Settings.canDrawOverlays(this)) startService(Intent(this, OverlayService::class.java))
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
    override fun onStop() {
        visible = false
        stopService(Intent(this, OverlayService::class.java))
        super.onStop()
    }
    fun authorize(email: String?): CompletableFuture<Pair<String, String>> = runtime.google.connect(this, email)
    fun requestOverlay(): JSONObject {
        check(visible)
        val granted = Settings.canDrawOverlays(this)
        if (granted) startService(Intent(this, OverlayService::class.java))
        else {
            pendingOverlay = true
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        return JSONObject().put("overlayGranted", granted)
            .put("requested", !granted).put("scope", "visible-app-only")
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
        @Volatile var visible = false
            private set
    }
}
