package com.nyxplayer.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import app.tauri.plugin.PluginManager

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Tauri 2.11 ne relaie plus ces trois moments aux plugins : TauriActivity ne les transmet pas et
  // son observateur de cycle de vie n'est jamais branché. Sans eux, le lecteur ne se coupe pas quand
  // l'app passe en arrière-plan et ne reprend pas au retour (NyxAndroidPlugin.onStop / onResume).
  // Tauri 2.12 les relaie de nouveau lui-même : retirer ce bloc en passant en 2.12, sinon chaque
  // plugin les recevrait deux fois (scripts/test/android-cycle-de-vie-tauri.test.mjs le vérifie).
  override fun onResume() {
    super.onResume()
    PluginManager.onResume()
  }

  override fun onPause() {
    super.onPause()
    PluginManager.onPause()
  }

  override fun onStop() {
    super.onStop()
    PluginManager.onStop()
  }
}
