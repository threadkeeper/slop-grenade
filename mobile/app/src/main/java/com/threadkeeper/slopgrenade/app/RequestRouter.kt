package com.threadkeeper.slopgrenade.app

import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.threadkeeper.slopgrenade.accounts.AccountState
import com.threadkeeper.slopgrenade.gmail.GmailClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CompletableFuture

/** Android account routes are explicit; only a small native API allowlist reaches JNI. */
class RequestRouter(private val activity: MainActivity, private val runtime: MobileRuntime) {
    private val main = Handler(Looper.getMainLooper())
    private fun response(status: Int, body: Any) = JSONObject().put("status", status).put("body", body)
    private fun error(status: Int, message: String) = response(status, JSONObject().put("error", message))
    private fun <T> onMain(action: () -> T): CompletableFuture<T> {
        val future = CompletableFuture<T>()
        main.post {
            try {
                check(!activity.isFinishing && !activity.isDestroyed) { "Activity unavailable" }
                future.complete(action())
            } catch (_: Exception) { future.completeExceptionally(IllegalStateException("Activity unavailable")) }
        }
        return future
    }
    fun dispatch(method: String, path: String, body: JSONObject): CompletableFuture<JSONObject> {
        val reconnect = Regex("""/api/v1/accounts/([a-f0-9]{64})/reconnect""").matchEntire(path)
        if (method == "POST" && (path == "/api/v1/accounts/add" || reconnect != null)) {
            if (!runtime.consentActive.compareAndSet(false, true))
                return CompletableFuture.completedFuture(error(409, "Authorization already active"))
            val id = reconnect?.groupValues?.get(1)
            return CompletableFuture.supplyAsync({
                if (id == null) null else (runtime.accounts.all().find { it.id == id }?.label
                    ?: throw IllegalArgumentException("Account not found"))
            }, runtime.io).thenCompose { email ->
                onMain { activity.authorize(email) }.thenCompose { it }
            }.thenApplyAsync({ (selected, token) ->
                // Verify identity from Gmail itself, not just a caller-provided account label.
                val profile = GmailClient.https(token).get("/profile")
                val email = profile.getString("emailAddress")
                require(AccountState.identity(selected) == AccountState.identity(email))
                val account = runtime.engine.connect(email, id)
                GmailWorker.schedule(activity.applicationContext)
                runtime.io.execute { try { runtime.engine.scanAll() } catch (_: Exception) { /* Worker retries. */ } }
                response(200, JSONObject().put("ok", true).put("account", accountJson(account)))
            }, runtime.io).handle { value, failure ->
                runtime.consentActive.set(false)
                value ?: AuthorizationErrorResponse.from(failure)
            }
        }
        if (method == "POST" && path == "/api/v1/overlay/permission") {
            return onMain { response(200, activity.requestOverlay()) }
        }
        if (method == "POST" && path == "/api/v1/overlay/stop") {
            return onMain { response(200, activity.stopOverlay()) }
        }
        return CompletableFuture.supplyAsync({
            when {
                method == "GET" && path == "/api/v1/accounts" -> response(200, JSONObject()
                    .put("accounts", JSONArray().also { array -> runtime.accounts.all().forEach { array.put(accountJson(it)) } })
                    .put("backgroundStatus", "Network-constrained 15-minute minimum, best effort. ${runtime.engine.status}")
                    .put("overlayGranted", Settings.canDrawOverlays(activity))
                    .put("overlayActive", OverlayService.active)
                    .put("overlayScope", "user-started-foreground-service")
                    .put("notificationsGranted", OverlayService.notificationsAllowed(activity)))
                method == "DELETE" && path.matches(Regex("""/api/v1/accounts/[a-f0-9]{64}""")) -> {
                    if (runtime.consentActive.get()) error(409, "Finish account authorization first")
                    else {
                        val disconnected = runtime.engine.disconnect(path.substringAfterLast('/'))
                        if (runtime.accounts.all().isEmpty()) GmailWorker.cancel(activity.applicationContext)
                        response(200, disconnected)
                    }
                }
                method == "POST" && path == "/api/v1/scan/now" -> {
                    if (body.optInt("lookbackDays", 7) != 7 || body.optBoolean("useLuna", false))
                        error(422, "Android scans support seven days and deterministic scoring only")
                    else {
                        val summary = runtime.engine.refreshAllSevenDays()
                        response(if (summary.ok) 200 else 503, summary.toJson())
                    }
                }
                (method == "POST" && path in setOf("/api/v1/auth/github-token", "/api/v1/analyze", "/api/v1/simulate")) ||
                    (method == "GET" && path == "/api/v1/auth/status") ->
                    runtime.manual.request(method, path, body)
                BridgePolicy.nativeAllowed(method, path) ->
                    runtime.core.request(method, path, body)
                else -> error(404, "Route unavailable")
            }
        }, runtime.io)
    }
    private fun accountJson(account: AccountState) = JSONObject().put("id", account.id).put("label", account.label)
        .put("connected", !account.reconnectRequired).put("lastSuccessfulScan", account.lastSuccessfulScan ?: JSONObject.NULL)
        .put("reconnectRequired", account.reconnectRequired)
}
