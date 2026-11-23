package com.dhruvgoel.habitloop.shared

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonNull

fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

@Serializable
data class WearDay(val date: String = "", val steps: Int? = null, val workouts: Int = 0)

@Serializable
data class WearWorkout(
    val id: String = "",
    val type: String = "",
    @SerialName("started_at") val startedAt: String = "",
    @SerialName("duration_min") val durationMin: Int? = null,
    val steps: Int? = null,
    @SerialName("avg_heart_rate") val avgHeartRate: Double? = null,
    val status: String = "",
    val reason: String? = null
)

/** Response of GET /api/integrations/links/{id}/stats. */
@Serializable
data class WearStats(
    val today: WearDay = WearDay(),
    val daily: List<WearDay> = emptyList(),
    val workouts: List<WearWorkout> = emptyList()
)

object WearFmt {
    fun time12(value: String, zone: ZoneId = ZoneId.systemDefault()): String =
        WearableStats.instant(value)?.atZone(zone)?.format(DateTimeFormatter.ofPattern("h:mm a", Locale.US)) ?: "Unknown time"

    fun dateTime12(value: String, zone: ZoneId = ZoneId.systemDefault()): String =
        WearableStats.instant(value)?.atZone(zone)?.format(DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.US)) ?: "Unknown time"

    fun typeLabel(type: String): String = when (type.lowercase()) {
        "walk" -> "Walk"
        "run" -> "Run"
        "cycle" -> "Cycle"
        "" -> "Workout"
        else -> type.replaceFirstChar { it.uppercase() }
    }

    fun title(w: WearWorkout): String = typeLabel(w.type) + (w.durationMin?.let { ", $it min" } ?: "")
}

data class WearableWorkout(
    val eventId: String,
    val time: String,
    val type: String,
    val duration: String,
    val steps: String,
    val heartRate: String
)

object WearableStats {
    private fun payload(log: ActivityLog): JsonObject = JsonObject(log.metadata + mapOf(
        "type" to JsonPrimitive(if (log.durationMin == null) "steps" else "workout"),
        "started_at" to JsonPrimitive(log.loggedAt)
    ) + (log.durationMin?.let { mapOf("duration_min" to JsonPrimitive(it)) } ?: emptyMap()))
    fun instant(value: String): Instant? = try { Instant.parse(value) } catch (e: Exception) { null }

    fun displayTime(value: String): String = instant(value)?.atZone(ZoneId.systemDefault())
        ?.format(DateTimeFormatter.ofPattern("MMM d, h:mm:ss a", Locale.US)) ?: "Unknown time"

    // Daily step events are cumulative snapshots. Workouts overlap these totals.
    fun todaySteps(events: List<PartnerEvent>, logs: List<ActivityLog>, today: LocalDate = LocalDate.now()): Int? {
        val snapshots = events.filter { it.status != "rejected" }.map { it.payload } + logs.filter { it.source == "partner" }.map { payload(it) }
        return snapshots.filter {
            it.text("type") == "steps" && instant(it.text("started_at") ?: "")
                ?.atZone(ZoneId.systemDefault())?.toLocalDate() == today
        }.mapNotNull { it.text("steps")?.toIntOrNull()?.takeIf { n -> n >= 0 } }.maxOrNull()
    }

    fun workouts(events: List<PartnerEvent>, logs: List<ActivityLog>): List<WearableWorkout> {
        val raw = events.filter { it.status != "rejected" }.map { it.eventId to it.payload } + logs.filter { it.source == "partner" }
            .map { (it.metadata.text("event_id") ?: it.sourceEventId ?: it.id) to payload(it) }
        return raw.filter { it.second.text("type") == "workout" }.distinctBy { it.first }
            .map { (id, p) -> WearableWorkout(id, p.text("started_at") ?: "", p.text("provider_activity") ?: "Workout",
                p.text("duration_min") ?: "Unavailable", p.text("steps") ?: "Unavailable", p.text("avg_heart_rate") ?: "Unavailable") }
            .sortedByDescending { instant(it.time) ?: Instant.MIN }.take(20)
    }
}
