package com.threadkeeper.slopgrenade.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.threadkeeper.slopgrenade.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppIconTest {
    @Test fun launcherAndNotificationUseBundledIcons() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(R.mipmap.ic_launcher, context.applicationInfo.icon)
        val icon = context.packageManager.getApplicationIcon(context.packageName)
        assertTrue(icon is AdaptiveIconDrawable)
        val bitmap = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888)
        try {
            icon.setBounds(0, 0, bitmap.width, bitmap.height)
            icon.draw(Canvas(bitmap))
            var pink = 0
            for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
                val color = bitmap.getPixel(x, y)
                if (Color.alpha(color) > 0 && Color.red(color) > 150 &&
                    Color.blue(color) > 75 && Color.green(color) < 100) pink++
            }
            assertTrue("The launcher icon should contain the pink grenade artwork", pink > 20)
        } finally { bitmap.recycle() }
        assertNotNull(context.getDrawable(R.drawable.ic_notification))
    }
}
