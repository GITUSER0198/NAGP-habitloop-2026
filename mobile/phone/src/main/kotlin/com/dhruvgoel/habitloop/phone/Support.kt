package com.dhruvgoel.habitloop.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dhruvgoel.habitloop.shared.ActivityMap
import com.dhruvgoel.habitloop.shared.HabitApi
import com.dhruvgoel.habitloop.shared.HabitJson
import com.dhruvgoel.habitloop.shared.Pairing
import com.dhruvgoel.habitloop.shared.PairingPayload
import com.dhruvgoel.habitloop.shared.TimeFmt
import com.dhruvgoel.habitloop.shared.TokenStore
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import java.net.URL
import java.time.LocalTime
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

object WatchPairing {
    /** Creates the link, stores it, sends it over the Data Layer. Returns the connected watch names. */
    suspend fun pair(context: Context, api: HabitApi, store: TokenStore, progress: (String) -> Unit = {}): String {
        progress("Checking connected wearables...")
        val nodes = Wearable.getNodeClient(context).connectedNodes.await()
        if (nodes.isEmpty()) throw ApiException0("No wearable connected")
        progress("Loading habits for the active community...")
        val map: Map<String, String> = ActivityMap.build(api.activities())
        if (map.isEmpty()) throw ApiException0("Create a habit first")
        progress("Preparing the wearable link...")
        val previous = store.pairing?.takeIf {
            it.baseUrl == BuildConfig.API_BASE_URL && it.activityMap == map &&
                api.links().any { link -> link.id == it.linkId }
        }
        val link = previous?.let { com.dhruvgoel.habitloop.shared.IntegrationLink(it.linkId, ingestKey = it.ingestKey) }
            ?: api.createWatchLink(map)
        val payload = PairingPayload(
            linkId = link.id,
            ingestKey = link.ingestKey ?: throw ApiException0("No ingest key returned"),
            baseUrl = BuildConfig.API_BASE_URL,
            token = store.token ?: "",
            activityMap = map,
            userName = store.userName,
            email = store.email,
            password = store.password
        )
        progress("Sending pairing to ${nodes.joinToString { it.displayName }}...")
        val req = PutDataMapRequest.create(Pairing.PATH)
        req.dataMap.putString(Pairing.KEY_JSON, HabitJson.encodeToString(PairingPayload.serializer(), payload))
        req.dataMap.putLong("ts", System.currentTimeMillis())
        Wearable.getDataClient(context).putDataItem(req.asPutDataRequest().setUrgent()).await()
        store.pairing = payload
        return nodes.joinToString { it.displayName }
    }
}

class ApiException0(message: String) : Exception(message)

@Composable
fun RemoteImage(path: String, modifier: Modifier) {
    var bmp: ImageBitmap? by remember(path) { mutableStateOf(null) }
    LaunchedEffect(path) {
        bmp = withContext(Dispatchers.IO) {
            try {
                val full: String = if (path.startsWith("http")) path else BuildConfig.API_BASE_URL.trimEnd('/') + path
                URL(full).openConnection().apply { connectTimeout = 8000; readTimeout = 15000 }
                    .getInputStream().use { BitmapFactory.decodeStream(it)?.asImageBitmap() }
            } catch (e: Exception) { null }
        }
    }
    bmp?.let { Image(it, null, modifier, contentScale = ContentScale.Crop) }
}

/** Local notifications for habits due within the next 15 minutes. Times are shown in 12-hour form. */
class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = TokenStore(applicationContext)
        if (store.token == null) return Result.success()
        val api = HabitApi(BuildConfig.API_BASE_URL, { store.token }, reauth = {
                if (store.email.isBlank() || store.password.isEmpty()) null
                else try { HabitApi(BuildConfig.API_BASE_URL, { null }).login(store.email, store.password).token.also { store.token = it } } catch (e: Exception) { null }
            })
        val today = try { api.today() } catch (e: Exception) { return Result.retry() }
        val now: LocalTime = LocalTime.now()
        val mgr = NotificationManagerCompat.from(applicationContext)
        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("habits", "Habit reminders", NotificationManager.IMPORTANCE_DEFAULT))
        for (h in today) {
            if (h.status != null) continue
            val due: LocalTime = try { LocalTime.parse(h.preferredTime) } catch (e: Exception) { continue }
            val mins: Long = java.time.Duration.between(now, due).toMinutes()
            if (mins in 0..15) {
                val n = NotificationCompat.Builder(applicationContext, "habits")
                    .setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(h.name)
                    .setContentText("Due at " + TimeFmt.to12h(h.preferredTime))
                    .build()
                try { mgr.notify(h.id.hashCode(), n) } catch (e: SecurityException) { /* permission not granted */ }
            }
        }
        return Result.success()
    }

    companion object {
        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<ReminderWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("habit-reminders", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
