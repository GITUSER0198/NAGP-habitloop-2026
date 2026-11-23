package com.dhruvgoel.habitloop.wear

import android.content.Context
import com.dhruvgoel.habitloop.shared.ApiException
import com.dhruvgoel.habitloop.shared.HabitApi
import com.dhruvgoel.habitloop.shared.PairingPayload
import com.dhruvgoel.habitloop.shared.TokenStore

/** Watch-side session: pairing data, an API client, and a silent re-login when the token expires. */
class Session private constructor(context: Context) {
    val store: TokenStore = TokenStore(context.applicationContext)
    val api: HabitApi get() = HabitApi(store.pairing?.baseUrl ?: BuildConfig.API_BASE_URL, { store.token })

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
        @Volatile private var instance: Session? = null
        fun get(context: Context): Session =
            instance ?: synchronized(this) { instance ?: Session(context).also { instance = it } }
    }
}
