plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// libmpv LGPL build (github.com/kunai974/libmpv-android-lgpl, GitHub Actions artifact),
// versioned in this repository: the APK never depends on a binary we did not produce.
repositories {
    maven { url = uri("$projectDir/libs/maven") }
}

android {
    namespace = "com.nyxplayer.nativebridge"
    compileSdk = 36

    defaultConfig {
        // libmpv requires API 26 (Android 8.0)
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    // libmpv is compiled for Java 17
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.core:core-ktx:1.13.1")

    // Video engine: mpv 0.41 + FFmpeg 9.0 built WITHOUT GPL components (LGPL), see src/data/thirdPartyLicenses.ts
    implementation("com.nyxplayer:libmpv-lgpl:0.41.0-3")

    // Tests JVM de la logique sans Android (AudioFocusPolicyTest, MediaSessionPolicyTest) : ./gradlew :tauri-plugin-nyx-android:testDebugUnitTest
    testImplementation("junit:junit:4.13.2")
}
