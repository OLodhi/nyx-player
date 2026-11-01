buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        // 2.1.x : lit les bibliothèques compilées en Kotlin 2.2 (libmpv 1.0.0) tout en acceptant
        // encore le DSL kotlinOptions des modules Tauri (erreur à partir de Kotlin 2.2)
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.21")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // libmpv LGPL versionnée dans le plugin (dépendance transitive : l'app doit aussi voir ce dépôt)
        maven { url = uri("${rootDir}/../../plugins/tauri-plugin-nyx-android/android/libs/maven") }
    }
}

tasks.register("clean").configure {
    delete("build")
}

