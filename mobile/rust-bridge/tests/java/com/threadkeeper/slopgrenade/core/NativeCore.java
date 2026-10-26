package com.threadkeeper.slopgrenade.core;

/** Host JVM smoke test for the exact Kotlin static JNI signature. */
public final class NativeCore {
    public static native String request(String input);

    public static void main(String[] args) {
        System.load(args[0]);
        String session = request("{\"method\":\"GET\",\"path\":\"/internal/session\"}");
        if (!session.contains("\"status\":200") ||
                !session.equals(request("{\"method\":\"GET\",\"path\":\"/internal/session\"}"))) {
            throw new AssertionError("Native session was not preserved");
        }
        for (String input : new String[] {
                "", "\0", "private \uD83D\uDD12", "\uD800",
                "{\"method\":42,\"path\":\"private\"}",
                "[".repeat(256) + "\"private\"" + "]".repeat(256),
                "{\"method\":\"GET\",\"path\":\"/api/v1/events?after=18446744073709551616\"}"
        }) {
            String response = request(input);
            if (!response.contains("\"status\":400") || response.contains("private")) {
                throw new AssertionError("Malformed request was not sanitized");
            }
        }
        try {
            request(null);
            throw new AssertionError("Null input did not throw");
        } catch (IllegalStateException expected) {
            if (!"Native request failed".equals(expected.getMessage())) {
                throw new AssertionError("JNI error was not sanitized");
            }
        }
        if (!session.equals(request("{\"method\":\"GET\",\"path\":\"/internal/session\"}"))) {
            throw new AssertionError("JNI failure damaged session");
        }
        System.out.println("JNI smoke passed: static symbol, session, malformed input, null exception");
    }
}
