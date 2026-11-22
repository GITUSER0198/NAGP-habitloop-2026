package com.dhruvgoel.habitloop.wear

import android.content.Context
import android.util.Log
import com.dhruvgoel.habitloop.shared.HabitJson
import com.dhruvgoel.habitloop.shared.Pairing
import com.dhruvgoel.habitloop.shared.PairingPayload
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.tasks.await

const val WEAR_TAG = "HabitLoopWear"

object PairingReader {
    fun parse(item: DataMapItem): PairingPayload? = try {
        HabitJson.decodeFromString(PairingPayload.serializer(), item.dataMap.getString(Pairing.KEY_JSON) ?: "")
    } catch (e: Exception) { null }

    /** Pulls an existing pairing item from the Data Layer (used on app start). Returns true if one was applied. */
    suspend fun pullExisting(context: Context): Boolean {
        val buffer = Wearable.getDataClient(context).dataItems.await()
        try {
            for (item in buffer) {
                if (item.uri.path == Pairing.PATH) {
                    val p: PairingPayload = parse(DataMapItem.fromDataItem(item)) ?: continue
                    Session.get(context).apply(p)
                    Log.i(WEAR_TAG, "pairing applied from Data Layer")
                    return true
                }
            }
        } finally {
            buffer.release()
        }
        return false
    }
}

class PairingService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.type == DataEvent.TYPE_CHANGED && e.dataItem.uri.path == Pairing.PATH) {
                val p: PairingPayload = PairingReader.parse(DataMapItem.fromDataItem(e.dataItem)) ?: continue
                Session.get(applicationContext).apply(p)
                Log.i(WEAR_TAG, "pairing received from phone")
            }
        }
    }
}
