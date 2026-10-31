package com.threadkeeper.slopgrenade.app

import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Isolate bounded Gmail display fetches from scanning and live overlay commands. */
class GmailDetailsDispatcher : AutoCloseable {
    private val executor = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(2))

    fun submit(action: () -> JSONObject): CompletableFuture<JSONObject> =
        CompletableFuture.supplyAsync({ action() }, executor)

    override fun close() {
        executor.shutdownNow()
    }
}
