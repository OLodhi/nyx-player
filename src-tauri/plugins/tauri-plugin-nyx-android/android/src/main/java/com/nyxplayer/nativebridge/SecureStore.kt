package com.nyxplayer.nativebridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Secrets encrypted with a non-exportable AES-256-GCM key held by the Android Keystore.
 * Only the ciphertext (iv:payload) is written to the app-private SharedPreferences.
 * Writes use commit(), not apply(): the call returns only once the value is on disk. The Supabase
 * session lives here, and its refresh token is replaced by the server on every refresh: a write lost
 * to an app kill would leave a token the server already revoked (user logged out).
 */
class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun set(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val payload = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val encoded = SecureStoreFormat.join(b64(cipher.iv), b64(payload))
        if (!prefs.edit().putString(key, encoded).commit()) throw IllegalStateException("SecureStore write failed")
    }

    fun get(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        val (iv, encrypted) = SecureStoreFormat.split(stored) ?: run {
            delete(key)
            return null
        }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, unb64(iv)))
            String(cipher.doFinal(unb64(encrypted)), Charsets.UTF_8)
        } catch (e: KeyPermanentlyInvalidatedException) {
            // Key invalidated (lock screen reset...): the ciphertext can never be decrypted again,
            // so drop it and let the user log in again.
            delete(key)
            null
        } catch (e: AEADBadTagException) {
            // Ciphertext from another key (app data restored from a backup on another device):
            // unreadable for good, dropped as well.
            delete(key)
            null
        }
        // Any other failure (Keystore momentarily unavailable, e.g. at boot or while the device is
        // locked) is thrown to the caller WITHOUT deleting the secret: the frontend retries instead of
        // sending the user back to the provider login.
    }

    fun delete(key: String) {
        if (!prefs.edit().remove(key).commit()) throw IllegalStateException("SecureStore delete failed")
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun unb64(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "nyxplayer_secure_store_v1"
        const val PREFS_NAME = "nyx_secure_store"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}
