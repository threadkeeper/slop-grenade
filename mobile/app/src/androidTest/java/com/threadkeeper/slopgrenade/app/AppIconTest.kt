package com.threadkeeper.slopgrenade.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.threadkeeper.slopgrenade.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppIconTest {
    @Test fun launcherAndNotificationUseBundledIcons() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(R.mipmap.ic_launcher, context.applicationInfo.icon)
        assertNotNull(context.packageManager.getApplicationIcon(context.packageName))
        assertNotNull(context.getDrawable(R.drawable.ic_notification))
    }
}
