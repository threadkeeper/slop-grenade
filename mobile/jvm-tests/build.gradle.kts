plugins { kotlin("jvm") version "2.1.20" }
kotlin {
    jvmToolchain(17)
    sourceSets {
        main {
            kotlin.srcDirs("../accounts/src/main/java", "../core/src/main/java", "../app/src/main/java")
            kotlin.include("**/AccountState.kt", "**/AccountRepository.kt", "**/CoreApi.kt",
                "**/NativeCore.kt", "**/ScanEngine.kt", "**/BridgePolicy.kt", "**/GmailDetails.kt",
                "**/GmailDetailsDispatcher.kt",
                "**/LunaClient.kt", "**/ManualAnalysis.kt", "**/AuthorizationRequired.kt",
                "**/GoogleAuthorizationError.kt", "**/GoogleAuthorizationFailure.kt", "**/AuthorizationErrorResponse.kt",
                "**/ContentSecurityPolicy.kt", "**/OverlaySoundPreferences.kt")
        }
        test {
            kotlin.srcDirs("../accounts/src/test/java", "../core/src/test/java", "../app/src/test/java")
        }
    }
}
dependencies {
    implementation(project(":gmail"))
    implementation("org.json:json:20250107")
    testImplementation("junit:junit:4.13.2")
}
