plugins { id("com.android.application"); kotlin("android") }

val signingNames = listOf("SLOP_ANDROID_KEYSTORE", "SLOP_ANDROID_STORE_PASSWORD",
    "SLOP_ANDROID_KEY_ALIAS", "SLOP_ANDROID_KEY_PASSWORD")
android {
    namespace = "com.threadkeeper.slopgrenade"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.threadkeeper.slopgrenade"
        minSdk = 30
        targetSdk = 35
        ndk { abiFilters += setOf("arm64-v8a", "x86_64") }
        versionCode = 1
        versionName = "0.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        if (signingNames.all { !System.getenv(it).isNullOrBlank() }) create("environment") {
            storeFile = file(System.getenv("SLOP_ANDROID_KEYSTORE"))
            storePassword = System.getenv("SLOP_ANDROID_STORE_PASSWORD")
            keyAlias = System.getenv("SLOP_ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("SLOP_ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.findByName("environment")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = true; checkReleaseBuilds = true }
    androidResources {
        // AAPT's default underscore-directory filter drops SvelteKit's _app bundle.
        ignoreAssetsPatterns += listOf(
            "!.svn", "!.git", "!.ds_store", "!*.scc", ".*",
            "!CVS", "!thumbs.db", "!picasa.ini", "!*~"
        )
    }
    packaging { jniLibs { useLegacyPackaging = false } }
}
// Fail closed rather than producing an installable shell with missing dashboard/native code.
tasks.register("verifyPackagedRuntime") {
    doLast {
        require(file("src/main/assets/index.html").isFile) { "Run mobile/scripts/package-assets.sh first" }
        listOf("arm64-v8a", "x86_64").forEach {
            val library = file("src/main/jniLibs/$it/libslop_mobile_bridge.so")
            require(library.isFile) {
                "Missing $it native library; run mobile/scripts/build-native.sh"
            }
            val sdk = System.getenv("ANDROID_SDK_ROOT") ?: System.getenv("ANDROID_HOME")
            val ndk = System.getenv("ANDROID_NDK_HOME") ?: "$sdk/ndk/27.3.13750724"
            val host = if (System.getProperty("os.name").contains("Mac")) "darwin-x86_64" else "linux-x86_64"
            val nm = file("$ndk/toolchains/llvm/prebuilt/$host/bin/llvm-nm")
            require(nm.isFile) { "Install NDK 27.3.13750724 or set ANDROID_NDK_HOME" }
            val process = ProcessBuilder(nm.absolutePath, "--dynamic", "--defined-only", library.absolutePath)
                .redirectErrorStream(true).start()
            val symbols = process.inputStream.bufferedReader().readText()
            require(process.waitFor() == 0 && symbols.lineSequence().any {
                it.endsWith(" Java_com_threadkeeper_slopgrenade_core_NativeCore_request")
            }) { "Missing JNI request export in $it bridge; unsigned/unbindable shell packaging prohibited" }
        }
    }
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn("verifyPackagedRuntime") }
val verifyReleaseSigning = tasks.register("verifyReleaseSigning") {
    doLast {
        require(signingNames.all { !System.getenv(it).isNullOrBlank() }) {
            "Unsigned release packaging is prohibited; provide signing environment"
        }
        require(file(System.getenv("SLOP_ANDROID_KEYSTORE")).isFile) { "Release keystore not found" }
    }
}
// Lint and unit tests may inspect release variants without signing credentials.
// Guard the actual APK/AAB producers before they can create an unsigned release artifact.
tasks.matching { it.name in listOf("packageRelease", "packageReleaseBundle", "signReleaseBundle", "bundleRelease") }
    .configureEach { dependsOn(verifyReleaseSigning) }
dependencies {
    implementation(project(":accounts"))
    implementation(project(":gmail"))
    implementation(project(":core"))
    implementation("androidx.webkit:webkit:1.13.0")
    implementation("androidx.work:work-runtime:2.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250107")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
