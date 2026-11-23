package com.dhruvgoel.habitloop.shared

import java.net.ServerSocket
import kotlin.concurrent.thread
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class MobileApiTest {
    @Test
    fun tipsUseSignedInClientAndRetryOnceOn401() = runBlocking {
        val server = ServerSocket(0, 2, java.net.InetAddress.getByName("127.0.0.1"))
        server.soTimeout = 8000
        val authorizations = mutableListOf<String>()
        val serving = thread(isDaemon = true) {
            repeat(2) {
                server.accept().use { socket ->
                    socket.soTimeout = 8000
                    val reader = socket.getInputStream().bufferedReader()
                    val headers = generateSequence { reader.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                    val auth = headers.first { it.startsWith("Authorization:", ignoreCase = true) }.substringAfter(":").trim()
                    authorizations += auth
                    val body = if (auth == "Bearer fresh") """{"recommendations":[{"id":"r","kind":"timing","current_value":{"preferred_time":"09:00"},"suggested_value":{"preferred_time":"18:30"}}]}""" else "{}"
                    val code = if (auth == "Bearer fresh") "200 OK" else "401 Unauthorized"
                    socket.getOutputStream().write("HTTP/1.1 $code\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body".toByteArray())
                }
            }
        }
        try {
            var refreshes = 0
            val api = HabitApi("http://127.0.0.1:${server.localPort}", { "expired" }, reauth = { refreshes++; "fresh" })
            assertEquals("r", api.recommendations().single().id)
            assertEquals(listOf("Bearer expired", "Bearer fresh"), authorizations)
            assertEquals(1, refreshes)
        } finally { server.close(); serving.join(1000) }
    }

    @Test
    fun wearableSnapshotsDoNotDoubleCountWorkoutsOrNormalizedLogs() {
        fun payload(type: String, steps: Int): JsonObject = JsonObject(mapOf(
            "type" to JsonPrimitive(type), "steps" to JsonPrimitive(steps),
            "started_at" to JsonPrimitive("2026-11-23T12:00:00Z"),
            "provider_activity" to JsonPrimitive("walk"), "duration_min" to JsonPrimitive(5)
        ))
        val events = listOf(
            PartnerEvent(eventId = "daily1", status = "normalized", payload = payload("steps", 1200)),
            PartnerEvent(eventId = "daily2", status = "received", payload = payload("steps", 1700)),
            PartnerEvent(eventId = "bad", status = "rejected", payload = payload("steps", 99999)),
            PartnerEvent(eventId = "workout", status = "normalized", payload = payload("workout", 200))
        )
        val logs = listOf(ActivityLog(id = "log", source = "partner", durationMin = 5,
            metadata = JsonObject(mapOf("event_id" to JsonPrimitive("workout")))))
        assertEquals(1700, WearableStats.todaySteps(events, logs, LocalDate.parse("2026-11-23")))
        assertEquals(1, WearableStats.workouts(events, logs).size)
        assertNull(WearableStats.todaySteps(events, logs, LocalDate.parse("2026-11-24")))
        assertEquals("Unknown time", WearableStats.displayTime("invalid"))
    }
}
