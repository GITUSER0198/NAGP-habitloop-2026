package com.dhruvgoel.habitloop.shared

import java.time.Instant
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SharedTest {
    @Test
    fun signerMatchesBackendScheme() {
        // Reference computed with Node: createHmac('sha256', sha256('key-1')).update('{"a":1}')
        assertEquals(
            "sha256=1adb06b027dc56e711308c793751530ae25021dfea99aeda39b182e7849bc21c",
            HmacSigner.sign("{\"a\":1}", "key-1")
        )
    }

    @Test
    fun workoutEventHasContractFields() {
        val body: String = PartnerEvents.workout(
            eventId = "11111111-1111-4111-8111-111111111111",
            startedAt = Instant.parse("2026-11-22T08:00:00Z"),
            durationMin = 1, steps = 120, providerActivity = "walk", avgHeartRate = 98.5
        )
        val o: JsonObject = HabitJson.parseToJsonElement(body).jsonObject
        assertEquals("workout", o["type"]!!.jsonPrimitive.content)
        assertEquals("walk", o["provider_activity"]!!.jsonPrimitive.content)
        assertEquals("2026-11-22T08:00:00Z", o["started_at"]!!.jsonPrimitive.content)
        assertEquals("1", o["duration_min"]!!.jsonPrimitive.content)
        assertEquals("98.5", o["avg_heart_rate"]!!.jsonPrimitive.content)
    }

    @Test
    fun stepsEventOmitsDuration() {
        val o: JsonObject = HabitJson.parseToJsonElement(PartnerEvents.steps(startedAt = Instant.EPOCH, steps = 5200)).jsonObject
        assertEquals("steps", o["type"]!!.jsonPrimitive.content)
        assertNull(o["duration_min"])
    }

    @Test
    fun modelsDecodeBackendJson() {
        val auth: AuthResponse = HabitJson.decodeFromString(
            AuthResponse.serializer(),
            """{"token":"t","user":{"id":"u","name":"N","email":"e@x.com","extra":1},"community":{"id":"c","name":"P","kind":"personal"}}"""
        )
        assertEquals("t", auth.token)
        val item: TodayItem = HabitJson.decodeFromString(
            TodayItem.serializer(), """{"id":"a","name":"Run","preferred_time":"18:30","status":null,"due_at":"x"}"""
        )
        assertEquals("6:30 PM", TimeFmt.to12h(item.preferredTime))
        assertNull(item.status)
        assertEquals("12:05 AM", TimeFmt.to12h("00:05"))
    }
}
