plugins { id("com.android.library"); kotlin("android") }
android {
    namespace = "com.threadkeeper.slopgrenade.accounts"
    compileSdk = 35
    defaultConfig { minSdk = 30 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("com.google.android.gms:play-services-auth:21.3.0")
    testImplementation("junit:junit:4.13.2")
}
