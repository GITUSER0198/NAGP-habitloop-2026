plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val apiUrl: String = rootProject.extra["habitloopBaseUrl"] as String

android {
    namespace = "com.dhruvgoel.habitloop.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dhruvgoel.habitloop"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"$apiUrl\"")
            buildConfigField("String", "WEB_BASE_URL", "\"$apiUrl\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"$apiUrl\"")
            buildConfigField("String", "WEB_BASE_URL", "\"$apiUrl\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    kotlinOptions { jvmTarget = "21" }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}

// Deliver one current installable to the repository root without claiming that directory as an output.
val deliveredApk = rootProject.projectDir.parentFile.resolve("habitloop-phone-debug.apk")
tasks.register("deliverDebugApk") {
    val apk = layout.buildDirectory.file("outputs/apk/debug/phone-debug.apk")
    inputs.file(apk)
    outputs.file(deliveredApk)
    doLast {
        apk.get().asFile.copyTo(deliveredApk, overwrite = true)
        deliveredApk.setLastModified(System.currentTimeMillis())
    }
}
tasks.matching { it.name == "assembleDebug" }.configureEach { finalizedBy("deliverDebugApk") }
