package com.dhruvgoel.habitloop.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.dhruvgoel.habitloop.shared.PartnerEvents
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** adb shell am broadcast -a com.dhruvgoel.habitloop.TEST_EVENT --es kind walk (debug builds only). */
class DebugEventReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val kind: String = intent.getStringExtra("kind") ?: "walk"
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val started: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
            val body: String = if (kind == "steps") PartnerEvents.steps(startedAt = started, steps = 5200)
            else PartnerEvents.workout(startedAt = started, durationMin = 1, steps = 140, providerActivity = kind, avgHeartRate = 101.0)
            Log.i(WEAR_TAG, "test event $kind")
            Sender.send(context.applicationContext, body, kind, started)
            Log.i(WEAR_TAG, "test event result ${WorkoutState.phase.value}")
            pending.finish()
        }
    }
}
