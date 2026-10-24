package com.threadkeeper.slopgrenade.app

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Network-constrained, unique periodic work. Android may defer execution; no minute polling claim. */
class GmailWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (isStopped) return Result.retry()
        return try {
            if (MobileRuntime.get(applicationContext).engine.scanAll()) Result.retry() else Result.success()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            Result.retry()
        } catch (_: Exception) { Result.retry() }
    }

    companion object {
        private const val NAME = "gmail-account-scan"
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<GmailWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
        fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
    }
}
