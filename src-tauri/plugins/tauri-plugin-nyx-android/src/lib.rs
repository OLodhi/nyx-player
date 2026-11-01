use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// On desktop the plugin registers nothing: the frontend only calls it when running on Android.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nyx-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.nyxplayer.nativebridge", "NyxAndroidPlugin")?;
            Ok(())
        })
        .build()
}
