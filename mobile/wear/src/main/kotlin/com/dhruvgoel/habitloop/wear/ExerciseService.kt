package com.dhruvgoel.habitloop.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import com.dhruvgoel.habitloop.shared.PartnerEvents
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

/** Observable workout state, shared between the foreground service and the UI. */
object WorkoutState {
    val phase = MutableStateFlow("idle") // idle, running, sending, sent, logged, failed
    val kind = MutableStateFlow("")
    val steps = MutableStateFlow(0L)
    val heartRate = MutableStateFlow(0.0)
    val startedAt = MutableStateFlow<Instant?>(null)
    val message = MutableStateFlow("")
}

class ExerciseService : Service() {
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var client: ExerciseClient
    private val hrSamples: MutableList<Double> = mutableListOf()
    private var callbackSet: Boolean = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startWorkout(intent.getStringExtra(EXTRA_KIND) ?: "walk")
            ACTION_STOP -> stopWorkout()
        }
        return START_NOT_STICKY
    }

    private fun foreground(text: String) {
        val nm: NotificationManager = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("workout", "Workout", NotificationManager.IMPORTANCE_LOW))
        val n: Notification = Notification.Builder(this, "workout")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("HabitLoop workout")
            .setContentText(text)
            .setOngoing(true)
            .build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
    }

    private val callback: ExerciseUpdateCallback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            update.latestMetrics.getData(DataType.STEPS_TOTAL)?.let { WorkoutState.steps.value = it.total }
            update.latestMetrics.getData(DataType.HEART_RATE_BPM).forEach {
                hrSamples.add(it.value)
                WorkoutState.heartRate.value = it.value
            }
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) { Log.w(WEAR_TAG, "exercise registration failed") }
        override fun onAvailabilityChanged(dataType: androidx.health.services.client.data.DataType<*, *>, availability: Availability) {}
    }

    private fun exerciseType(kind: String): ExerciseType = when (kind) {
        "run" -> ExerciseType.RUNNING
        "cycle" -> ExerciseType.BIKING
        else -> ExerciseType.WALKING
    }

    private fun startWorkout(kind: String) {
        foreground("$kind in progress")
        WorkoutState.kind.value = kind
        WorkoutState.steps.value = 0
        WorkoutState.heartRate.value = 0.0
        hrSamples.clear()
        scope.launch {
            try {
                client = HealthServices.getClient(this@ExerciseService).exerciseClient
                val type: ExerciseType = exerciseType(kind)
                val supported: Set<DataType<*, *>> =
                    client.getCapabilitiesAsync().await().getExerciseTypeCapabilities(type).supportedDataTypes
                val wanted: Set<DataType<*, *>> = setOf<DataType<*, *>>(DataType.HEART_RATE_BPM, DataType.STEPS_TOTAL)
                    .intersect(supported)
                val config: ExerciseConfig = ExerciseConfig.builder(type)
                    .setDataTypes(wanted)
                    .setIsAutoPauseAndResumeEnabled(false)
                    .setIsGpsEnabled(false)
                    .build()
                client.setUpdateCallback(callback)
                callbackSet = true
                client.startExerciseAsync(config).await()
                WorkoutState.startedAt.value = Instant.now()
                WorkoutState.phase.value = "running"
                WorkoutState.message.value = ""
            } catch (e: Exception) {
                Log.w(WEAR_TAG, "start failed: ${e.javaClass.simpleName}")
                WorkoutState.phase.value = "failed"
                WorkoutState.message.value = "Could not start: ${e.message ?: e.javaClass.simpleName}"
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private fun stopWorkout() {
        val started: Instant = WorkoutState.startedAt.value ?: Instant.now()
        val kind: String = WorkoutState.kind.value
        scope.launch {
            WorkoutState.phase.value = "sending"
            try { client.endExerciseAsync().await() } catch (e: Exception) { Log.w(WEAR_TAG, "end failed") }
            if (callbackSet) runCatching { client.clearUpdateCallbackAsync(callback).await() }
            val seconds: Long = Duration.between(started, Instant.now()).seconds
            val minutes: Int = maxOf(1, ((seconds + 59) / 60).toInt())
            val steps: Int? = WorkoutState.steps.value.takeIf { it > 0 }?.toInt()
            val avg: Double? = if (hrSamples.isEmpty()) null else hrSamples.average()
            val body: String = PartnerEvents.workout(
                startedAt = started.truncatedTo(java.time.temporal.ChronoUnit.SECONDS), durationMin = minutes, steps = steps,
                providerActivity = kind, avgHeartRate = avg
            )
            Sender.send(applicationContext, body, kind, started)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onDestroy() {
        scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.dhruvgoel.habitloop.START"
        const val ACTION_STOP = "com.dhruvgoel.habitloop.STOP"
        const val EXTRA_KIND = "kind"

        fun start(context: Context, kind: String) {
            context.startForegroundService(Intent(context, ExerciseService::class.java).setAction(ACTION_START).putExtra(EXTRA_KIND, kind))
        }
        fun stop(context: Context) {
            context.startService(Intent(context, ExerciseService::class.java).setAction(ACTION_STOP))
        }
    }
}

/** Sends one signed event and then watches the activity log for up to 30 seconds. */
object Sender {
    suspend fun send(context: Context, body: String, kind: String, startedAt: Instant) {
        val session: Session = Session.get(context)
        val p = session.pairing
        if (p == null) {
            WorkoutState.phase.value = "failed"; WorkoutState.message.value = "Not paired"; return
        }
        try {
            val code: Int = session.api.ingest(p.linkId, p.ingestKey, body)
            Log.i(WEAR_TAG, "ingest status $code")
            WorkoutState.phase.value = "sent"
            WorkoutState.message.value = "Sent"
        } catch (e: Exception) {
            Log.w(WEAR_TAG, "ingest failed: ${e.message}")
            WorkoutState.phase.value = "failed"
            WorkoutState.message.value = "Send failed: ${e.message ?: e.javaClass.simpleName}"
            return
        }
        val activityId: String = p.activityMap[kind] ?: return
        val deadline: Long = System.currentTimeMillis() + 30_000
        while (System.currentTimeMillis() < deadline) {
            delay(3000)
            val seen: Boolean = try {
                session.authed { it.logs(activityId) }.any {
                    it.source == "partner" && runCatching { Instant.parse(it.loggedAt) >= startedAt.minusSeconds(2) }.getOrDefault(false)
                }
            } catch (e: Exception) { false }
            if (seen) {
                WorkoutState.phase.value = "logged"; WorkoutState.message.value = "Logged"
                Log.i(WEAR_TAG, "partner log visible")
                return
            }
        }
    }

    suspend fun sendSteps(context: Context, steps: Int) {
        val body: String = PartnerEvents.steps(startedAt = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS), steps = steps)
        WorkoutState.kind.value = "steps"
        send(context, body, "steps", Instant.now().minusSeconds(5))
    }
}
