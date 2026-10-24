package com.threadkeeper.slopgrenade.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.CompletableFuture

/** Bundled assets only. There is no JavascriptInterface, file access, remote navigation, or HTTP bridge. */
object TrustedWebView {
    @SuppressLint("SetJavaScriptEnabled")
    fun create(
        context: Context,
        dispatch: (String, String, JSONObject) -> CompletableFuture<JSONObject>,
        overlay: Boolean = false,
        overlaySound: OverlaySoundPreferences = OverlaySoundPreferences(),
    ): WebView {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            "Update Android System WebView to use Slop Grenade"
        }
        val main = Handler(Looper.getMainLooper())
        val loader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        // shouldInterceptRequest runs off main. Hash the packaged file, never request-controlled HTML.
        val policy by lazy {
            context.assets.open("index.html").bufferedReader(Charsets.UTF_8).use {
                ContentSecurityPolicy.forIndex(it.readText())
            }
        }
        return WebView(context).apply {
            settings.javaScriptEnabled = true
            // The trusted bundle persists only sound/volume; all app data remains backup-excluded.
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mediaPlaybackRequiresUserGesture = overlaySound.requiresGesture(overlay)
            CookieManager.getInstance().setAcceptCookie(false)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            setDownloadListener { _, _, _, _, _ -> /* Downloads are never permitted. */ }
            setBackgroundColor(if (overlay) Color.TRANSPARENT else Color.WHITE)
            isSaveEnabled = false
            importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !assetUri(request.url)
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    if (!assetUri(request.url) || request.method != "GET") return blocked()
                    val uri = if (request.url.path == "/") request.url.buildUpon().path("/index.html").build() else request.url
                    val result = loader.shouldInterceptRequest(uri) ?: return blocked()
                    result.responseHeaders = (result.responseHeaders ?: emptyMap()) + mapOf(
                        "Cache-Control" to "no-store",
                        "X-Content-Type-Options" to "nosniff",
                        "Content-Security-Policy" to policy)
                    return result
                }
            }
            WebViewCompat.addWebMessageListener(this, "SlopAndroid", setOf(BridgePolicy.ORIGIN)) {
                    _, message, sourceOrigin, isMainFrame, reply ->
                val data = message.data
                if (!BridgePolicy.trusted(sourceOrigin.toString(), isMainFrame) || data == null || data.length > 1_048_576)
                    return@addWebMessageListener
                try {
                    val input = JSONObject(data)
                    val id = input.get("id")
                    require(id is String || id is Number)
                    val method = input.getString("method")
                    val path = input.getString("path")
                    require(path.length <= 256)
                    dispatch(method, path, input.optJSONObject("body") ?: JSONObject())
                        .whenComplete { result, _ ->
                            val response = result ?: JSONObject().put("status", 503)
                                .put("body", JSONObject().put("error", "Android request unavailable"))
                            // Never serialize exception details, credentials, or request contents.
                            response.put("id", id)
                            main.post { try { reply.postMessage(response.toString()) } catch (_: Exception) { /* View closed. */ } }
                        }
                } catch (_: Exception) { /* Malformed/untrusted input gets no reflective response. */ }
            }
            loadUrl(if (overlay) overlaySound.url() else BridgePolicy.ORIGIN + "/index.html")
        }
    }

    private fun assetUri(uri: Uri) = uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
        uri.port == -1 && uri.userInfo == null
    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(),
        ByteArrayInputStream(ByteArray(0)))
}
