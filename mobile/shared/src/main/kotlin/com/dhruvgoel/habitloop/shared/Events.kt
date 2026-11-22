package com.dhruvgoel.habitloop.shared

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Builders for the signed partner events (`galaxywatch` provider). */
object PartnerEvents {
    fun workout(
        eventId: String = UUID.randomUUID().toString(),
        startedAt: Instant,
        durationMin: Int,
        steps: Int?,
        providerActivity: String,
        avgHeartRate: Double?
    ): String {
        val map: MutableMap<String, JsonElement> = linkedMapOf(
            "event_id" to JsonPrimitive(eventId),
            "type" to JsonPrimitive("workout"),
            "started_at" to JsonPrimitive(startedAt.toString()),
            "duration_min" to JsonPrimitive(durationMin),
            "provider_activity" to JsonPrimitive(providerActivity)
        )
        if (steps != null) map["steps"] = JsonPrimitive(steps)
        if (avgHeartRate != null && avgHeartRate > 0) map["avg_heart_rate"] = JsonPrimitive(avgHeartRate)
        return JsonObject(map).toString()
    }

    fun steps(eventId: String = UUID.randomUUID().toString(), startedAt: Instant, steps: Int): String {
        val map: Map<String, JsonElement> = linkedMapOf(
            "event_id" to JsonPrimitive(eventId),
            "type" to JsonPrimitive("steps"),
            "started_at" to JsonPrimitive(startedAt.toString()),
            "steps" to JsonPrimitive(steps),
            "provider_activity" to JsonPrimitive("steps")
        )
        return JsonObject(map).toString()
    }
}

/** 12-hour AM/PM display for "HH:MM" values. */
object TimeFmt {
    fun to12h(hhmm: String): String {
        val parts: List<String> = hhmm.split(":")
        val h: Int = parts.getOrNull(0)?.toIntOrNull() ?: return hhmm
        val m: Int = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val suffix: String = if (h >= 12) "PM" else "AM"
        val h12: Int = if (h % 12 == 0) 12 else h % 12
        return "%d:%02d %s".format(h12, m, suffix)
    }
}
