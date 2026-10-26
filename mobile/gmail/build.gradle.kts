plugins { `java-library` }
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
dependencies {
    compileOnly("org.json:json:20250107")
    testImplementation("org.json:json:20250107")
    testImplementation("junit:junit:4.13.2")
}
