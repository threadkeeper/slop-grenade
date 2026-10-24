package com.threadkeeper.slopgrenade.core

/** JNI ABI shared with mobile/rust-bridge. Android never opens a local HTTP server. */
object NativeCore {
    init { System.loadLibrary("slop_mobile_bridge") }
    @JvmStatic external fun request(input: String): String
}
