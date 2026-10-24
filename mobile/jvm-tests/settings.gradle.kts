pluginManagement { repositories { mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { mavenCentral() } }
rootProject.name = "SlopAndroidContractTests"
include(":gmail")
project(":gmail").projectDir = file("../gmail")
