package com.nyxplayer.nativebridge

/**
 * Décisions sur l'appareil et le réseau, sans appel Android (testées sur la JVM, DevicePolicyTest).
 * NyxAndroidPlugin lit les valeurs du système et les passe ici.
 */
internal object DevicePolicy {
    /** Seuil Android usuel entre téléphone et tablette */
    const val TABLET_MIN_WIDTH_DP = 600

    /**
     * Interface verrouillée en portrait sur téléphone (le paysage n'a pas de mise en page dédiée
     * hors lecteur) ; tablettes et TV gardent les deux sens.
     */
    fun locksPortrait(smallestWidthDp: Int, television: Boolean): Boolean =
        smallestWidthDp < TABLET_MIN_WIDTH_DP && !television

    /** Capacités du réseau actif, lues par le plugin (null : aucun réseau). */
    data class Capabilities(
        val internet: Boolean,
        val notMetered: Boolean,
        val wifi: Boolean,
        val cellular: Boolean,
        val ethernet: Boolean,
    )

    data class NetworkStatus(val connected: Boolean, val metered: Boolean, val type: String)

    /**
     * Type de connexion : l'EPG (environ 205 Mo) ne doit pas se télécharger sur des données
     * mobiles limitées. « metered » suit le réglage Android (Wi-Fi partagé compris) ; sans
     * connexion, rien n'est « limité ».
     */
    fun networkStatus(capabilities: Capabilities?): NetworkStatus {
        val connected = capabilities?.internet == true
        val metered = capabilities?.notMetered != true
        val type = when {
            capabilities == null -> "none"
            capabilities.wifi -> "wifi"
            capabilities.cellular -> "cellular"
            capabilities.ethernet -> "ethernet"
            else -> "other"
        }
        return NetworkStatus(connected, connected && metered, type)
    }
}
