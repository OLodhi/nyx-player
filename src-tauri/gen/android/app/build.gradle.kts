import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// --- signature de publication (début) ---
// Signature de publication : clé du mainteneur, gardée hors du dépôt.
// Elle ne s'active que si NYX_ANDROID_KEYSTORE est défini, le temps d'une compilation
// (scripts/android-release-apk.ps1).
// Sans cette variable, l'APK release reste non signé comme avant : la CI du PC et les scripts de
// test le signent ensuite eux-mêmes avec la clé de debug. Aucun mot de passe ni chemin ici.
class ReleaseSigning(
    val storeFile: File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

val releaseSigning: ReleaseSigning? = System.getenv("NYX_ANDROID_KEYSTORE")
    ?.takeIf { it.isNotBlank() }
    ?.let { path ->
        val keystore = file(path)
        if (!keystore.isFile) {
            throw GradleException("NYX_ANDROID_KEYSTORE : fichier de clé introuvable ($path)")
        }
        val storePassword = System.getenv("NYX_ANDROID_KEYSTORE_PASSWORD")
            ?.takeIf { it.isNotEmpty() }
            ?: throw GradleException(
                "NYX_ANDROID_KEYSTORE_PASSWORD manquant : l'APK de publication ne peut pas être signé"
            )
        ReleaseSigning(
            storeFile = keystore,
            storePassword = storePassword,
            keyAlias = System.getenv("NYX_ANDROID_KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "nyx",
            // PKCS12 : la clé a le même mot de passe que le fichier, sauf indication contraire
            keyPassword = System.getenv("NYX_ANDROID_KEY_PASSWORD")?.takeIf { it.isNotEmpty() } ?: storePassword,
        )
    }
// --- signature de publication (fin) ---

android {
    compileSdk = 36
    namespace = "com.nyxplayer.app"
    defaultConfig {
        // IPTV providers commonly serve plain http streams. Since Android 7 this flag is overridden by
        // res/xml/network_security_config.xml (clear text allowed, except Supabase, TMDB, nyxplayer.app).
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        // Version de mesure (scripts/android-mesure-apk.ps1) : autre nom interne et autre nom affiché,
        // pour s'installer À CÔTÉ de Nyx sans le remplacer. Par défaut : l'app normale.
        applicationId = System.getenv("NYX_ANDROID_APP_ID") ?: "com.nyxplayer.app"
        manifestPlaceholders["appLabel"] = System.getenv("NYX_ANDROID_APP_LABEL") ?: "@string/app_name"
        manifestPlaceholders["activityLabel"] = System.getenv("NYX_ANDROID_APP_LABEL") ?: "@string/main_activity_title"
        minSdk = 26 // libmpv (lecteur MPV) requiert Android 8.0
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        releaseSigning?.let { signing ->
            create("release") {
                storeFile = signing.storeFile
                storePassword = signing.storePassword
                keyAlias = signing.keyAlias
                keyPassword = signing.keyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (releaseSigning != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")