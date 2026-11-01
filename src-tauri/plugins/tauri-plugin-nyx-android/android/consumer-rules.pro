# Applied to the app's release build (R8).
# libmpv calls back into Kotlin from native code (JNI) and its observers are interfaces:
# keep the whole package, not only MPVLib (the library's own rule).
-keep class dev.jdtech.mpv.** { *; }

# Player engines are created by the plugin and log their class names in diagnostics.
-keep class com.nyxplayer.nativebridge.** { *; }
