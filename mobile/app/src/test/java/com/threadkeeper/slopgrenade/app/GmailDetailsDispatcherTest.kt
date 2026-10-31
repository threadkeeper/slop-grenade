package com.threadkeeper.slopgrenade.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

class GmailDetailsDispatcherTest {
    @Test fun limitsSlowGmailFetchesWithoutBlockingOtherAppWork() {
        val dispatcher = GmailDetailsDispatcher()
        val otherWork = Executors.newSingleThreadExecutor()
        val entered = CountDownLatch(2)
        val release = CountDownLatch(1)
        val action = {
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            JSONObject().put("ok", true)
        }
        try {
            val first = dispatcher.submit(action)
            val second = dispatcher.submit(action)
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            val third = dispatcher.submit(action)
            val fourth = dispatcher.submit(action)
            try { dispatcher.submit(action); fail("Unbounded details queue") }
            catch (_: RejectedExecutionException) { }
            assertEquals(42, otherWork.submit<Int> { 42 }.get(5, TimeUnit.SECONDS).toInt())
            release.countDown()
            listOf(first, second, third, fourth).forEach {
                assertTrue(it.get(5, TimeUnit.SECONDS).getBoolean("ok"))
            }
        } finally {
            release.countDown()
            dispatcher.close()
            otherWork.shutdownNow()
        }
    }
}
