package com.dhruvgoel.habitloop.wear

import android.content.Context
import com.dhruvgoel.habitloop.shared.ApiException
import com.dhruvgoel.habitloop.shared.HabitApi
import com.dhruvgoel.habitloop.shared.PairingPayload
import com.dhruvgoel.habitloop.shared.TokenStore

/** Watch-side session: pairing data, an API client, and a silent re-login when the token expires. */
class Session private constructor(context: Context) {
    val store: TokenStore = TokenStore(context.applicationContext)
    val api: HabitApi get() = HabitApi(baseUrl, { store.token })

    /** Server used for all calls. A stale local pairing (127.0.0.1 or localhost) falls back to the build URL. */
    val baseUrl: String get() {
        val stored: String? = store.pairing?.baseUrl?.takeIf { it.isNotBlank() }
        if (stored == null || isLocalHost(hostOf(stored))) return BuildConfig.API_BASE_URL
        return stored
    }

    /** Host only (no path, key or token), safe to show and log. */
    val host: String get() = hostOf(baseUrl)

    val pairing: PairingPayload? get() = store.pairing
    val isPaired: Boolean get() = store.pairing != null && store.token != null

    fun apply(p: PairingPayload) {
        store.pairing = p
        store.token = p.token
        store.email = p.email
        store.password = p.password
        store.userName = p.userName
    }

    /** Runs [block]; on a 401 signs in again with the stored credentials and retries once. */
    suspend fun <T> authed(block: suspend (HabitApi) -> T): T {
        try {
            return block(api)
        } catch (e: ApiException) {
            if (e.code != 401 || store.email.isBlank() || store.password.isEmpty()) throw e
            store.token = api.login(store.email, store.password).token
            return block(api)
        }
    }

    companion object {
        fun hostOf(url: String): String = try { java.net.URI(url).host ?: url } catch (e: Exception) { url }
        fun isLocalHost(host: String): Boolean = host == "127.0.0.1" || host.equals("localhost", ignoreCase = true)

        @Volatile private var instance: Session? = null
        fun get(context: Context): Session =
            instance ?: synchronized(this) { instance ?: Session(context).also { instance = it } }
    }
}
