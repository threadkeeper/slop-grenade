package com.threadkeeper.slopgrenade.accounts

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Single AES-GCM authenticated blob in backup-excluded private preferences. */
class SecureAccounts(context: Context, vaultName: String = "account_vault") : AccountRepository {
    private val preferences = context.getSharedPreferences(vaultName, Context.MODE_PRIVATE)
    private val alias = "slopgrenade.$vaultName.v1"
    private val aad = alias.toByteArray(Charsets.UTF_8)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
            generateKey()
        }
    }

    @Synchronized override fun all(): List<AccountState> {
        val encoded = preferences.getString("blob", null) ?: return emptyList()
        try {
            val envelope = JSONObject(encoded)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
            cipher.updateAAD(aad)
            val array = JSONArray(String(cipher.doFinal(Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)), Charsets.UTF_8))
            return (0 until array.length()).map {
                val value = array.getJSONObject(it)
                fun optional(name: String) = if (value.isNull(name)) null else value.optString(name).takeIf(String::isNotEmpty)
                AccountState(value.getString("id"), value.getString("label"), optional("checkpoint"),
                    optional("session"), optional("lastSuccessfulScan"), value.optBoolean("reconnectRequired"))
            }
        } catch (_: Exception) {
            // Never fall back to plaintext or overwrite a vault that cannot be authenticated.
            throw IllegalStateException("Account vault unavailable; clear app storage to reset")
        }
    }

    @Synchronized override fun put(account: AccountState) = write(all().filterNot { it.id == account.id } + account)
    @Synchronized override fun remove(id: String) = write(all().filterNot { it.id == id })

    private fun write(accounts: List<AccountState>) {
        val array = JSONArray()
        accounts.forEach {
            array.put(JSONObject().put("id", it.id).put("label", it.label)
                .put("checkpoint", it.checkpoint).put("session", it.session)
                .put("lastSuccessfulScan", it.lastSuccessfulScan).put("reconnectRequired", it.reconnectRequired))
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(aad)
        val ciphertext = cipher.doFinal(array.toString().toByteArray(Charsets.UTF_8))
        val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        check(preferences.edit().putString("blob", envelope.toString()).commit()) { "Account vault write failed" }
    }
}
