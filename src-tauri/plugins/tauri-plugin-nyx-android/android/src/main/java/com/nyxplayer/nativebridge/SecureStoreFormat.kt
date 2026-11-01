package com.nyxplayer.nativebridge

/**
 * Format d'un secret dans les préférences de SecureStore : « iv:chiffré », chaque partie en Base64.
 * Sans appel Android (testé sur la JVM, SecureStoreFormatTest) : le chiffrement reste dans SecureStore.
 */
internal object SecureStoreFormat {
    private const val SEPARATOR = ":"

    fun join(iv: String, payload: String): String = iv + SEPARATOR + payload

    /** Le vecteur d'initialisation et le chiffré, ou null si la valeur n'a pas ce format (elle est alors effacée). */
    fun split(stored: String): Pair<String, String>? {
        val parts = stored.split(SEPARATOR)
        return if (parts.size == 2) parts[0] to parts[1] else null
    }
}
