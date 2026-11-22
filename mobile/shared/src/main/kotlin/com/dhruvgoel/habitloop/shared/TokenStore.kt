package com.dhruvgoel.habitloop.shared

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Session and pairing storage, encrypted at rest. Nothing here is ever logged. */
class TokenStore(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "habitloop_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var token: String?
        get() = prefs.getString("token", null)
        set(v) { prefs.edit().putString("token", v).apply() }

    var email: String
        get() = prefs.getString("email", "") ?: ""
        set(v) { prefs.edit().putString("email", v).apply() }

    var password: String
        get() = prefs.getString("password", "") ?: ""
        set(v) { prefs.edit().putString("password", v).apply() }

    var userName: String
        get() = prefs.getString("user_name", "") ?: ""
        set(v) { prefs.edit().putString("user_name", v).apply() }

    var pairing: PairingPayload?
        get() = prefs.getString("pairing", null)?.let {
            try { HabitJson.decodeFromString(PairingPayload.serializer(), it) } catch (e: Exception) { null }
        }
        set(v) {
            prefs.edit().putString("pairing", v?.let { HabitJson.encodeToString(PairingPayload.serializer(), it) }).apply()
        }

    fun clear() { prefs.edit().clear().apply() }
}
