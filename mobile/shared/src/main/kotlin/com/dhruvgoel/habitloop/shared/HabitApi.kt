package com.dhruvgoel.habitloop.shared

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class ApiException(val code: Int, message: String) : Exception(message)

/** [reauth] signs in again and returns a fresh token; called once when a signed-in request gets 401. */
class HabitApi(
    private val baseUrl: String,
    private val tokenProvider: () -> String?,
    private val reauth: (suspend () -> String?)? = null
) {

    data class Reply(val code: Int, val body: String)

    private suspend fun call(
        method: String,
        path: String,
        body: String? = null,
        headers: Map<String, String> = emptyMap(),
        auth: Boolean = true
    ): Reply {
        val first: Reply = send(method, path, body, headers, if (auth) tokenProvider() else null)
        if (first.code != 401 || !auth || reauth == null) return first
        val fresh: String = reauth.invoke() ?: return first
        return send(method, path, body, headers, fresh)
    }

    private suspend fun send(
        method: String,
        path: String,
        body: String?,
        headers: Map<String, String>,
        token: String?
    ): Reply = withContext(Dispatchers.IO) {
        val conn: HttpURLConnection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 8000
            conn.readTimeout = 15000
            conn.setRequestProperty("Accept", "application/json")
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code: Int = conn.responseCode
            val text: String = (if (code >= 400) conn.errorStream else conn.inputStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            Reply(code, text)
        } finally {
            conn.disconnect()
        }
    }

    private fun check(reply: Reply): String {
        if (reply.code !in 200..299) {
            val detail: String = try {
                val obj: JsonObject? = HabitJson.parseToJsonElement(reply.body) as? JsonObject
                (obj?.get("detail") as? JsonPrimitive)?.content
                    ?: (obj?.get("message") as? JsonPrimitive)?.content ?: "HTTP ${reply.code}"
            } catch (e: Exception) {
                "HTTP ${reply.code}"
            }
            throw ApiException(reply.code, detail)
        }
        return reply.body
    }

    suspend fun login(email: String, password: String): AuthResponse {
        val b: String = buildJsonObject { put("email", email); put("password", password) }.toString()
        return HabitJson.decodeFromString(AuthResponse.serializer(), check(call("POST", "/api/users/login", b, auth = false)))
    }

    suspend fun register(email: String, password: String, name: String): AuthResponse {
        val b: String = buildJsonObject { put("email", email); put("password", password); put("name", name) }.toString()
        return HabitJson.decodeFromString(AuthResponse.serializer(), check(call("POST", "/api/users/register", b, auth = false)))
    }

    suspend fun me(): Account =
        HabitJson.decodeFromString(Account.serializer(), check(call("GET", "/api/users/me")))

    suspend fun challenge(id: String): WallChallenge =
        HabitJson.decodeFromString(WallChallenge.serializer(), check(call("GET", "/api/challenges/$id")))

    suspend fun progress(id: String): ChallengeProgress =
        HabitJson.decodeFromString(ChallengeProgress.serializer(), check(call("GET", "/api/analytics/challenges/$id/progress")))

    suspend fun links(): List<IntegrationLink> =
        HabitJson.decodeFromString(ListSerializer(IntegrationLink.serializer()), check(call("GET", "/api/integrations/links")))

    suspend fun events(linkId: String): List<PartnerEvent> =
        HabitJson.decodeFromString(ListSerializer(PartnerEvent.serializer()), check(call("GET", "/api/integrations/links/$linkId/events")))

    suspend fun deleteWorkout(linkId: String, partnerEventId: String) {
        check(call("DELETE", "/api/integrations/links/$linkId/events/$partnerEventId"))
    }

    suspend fun communities(): List<MyCommunity> =
        HabitJson.decodeFromString(ListSerializer(MyCommunity.serializer()), check(call("GET", "/api/users/communities")))

    suspend fun switchCommunity(id: String): AuthResponse {
        val b: String = buildJsonObject { put("community_id", id) }.toString()
        return HabitJson.decodeFromString(AuthResponse.serializer(), check(call("POST", "/api/users/switch", b)))
    }

    suspend fun wall(cursor: String? = null): WallPage {
        val q: String = if (cursor != null) "?cursor=" + java.net.URLEncoder.encode(cursor, "UTF-8") else ""
        return HabitJson.decodeFromString(WallPage.serializer(), check(call("GET", "/api/challenges/wall$q")))
    }

    suspend fun joinChallenge(challengeId: String) { check(call("POST", "/api/challenges/$challengeId/join", "{}")) }

    suspend fun like(postId: String) { check(call("POST", "/api/challenges/wall/$postId/like", "{}")) }

    suspend fun comments(postId: String): List<WallComment> =
        HabitJson.decodeFromString(ListSerializer(WallComment.serializer()), check(call("GET", "/api/challenges/wall/$postId/comments")))

    suspend fun comment(postId: String, text: String) {
        check(call("POST", "/api/challenges/wall/$postId/comments", buildJsonObject { put("body", text) }.toString()))
    }

    suspend fun today(): List<TodayItem> =
        HabitJson.decodeFromString(ListSerializer(TodayItem.serializer()), check(call("GET", "/api/activities/today")))

    suspend fun activities(): List<Activity> =
        HabitJson.decodeFromString(ListSerializer(Activity.serializer()), check(call("GET", "/api/activities")))

    suspend fun summary(): Summary =
        HabitJson.decodeFromString(Summary.serializer(), check(call("GET", "/api/analytics/summary")))

    suspend fun heatmap(days: Int): List<DayCounts> =
        HabitJson.decodeFromString(ListSerializer(DayCounts.serializer()), check(call("GET", "/api/analytics/heatmap?days=$days")))

    suspend fun logActivity(activityId: String, status: String) {
        val b: String = buildJsonObject { put("status", status) }.toString()
        check(call("POST", "/api/activities/$activityId/logs", b))
    }

    suspend fun logs(activityId: String): List<ActivityLog> =
        HabitJson.decodeFromString(ListSerializer(ActivityLog.serializer()), check(call("GET", "/api/activities/$activityId/logs")))

    suspend fun recommendations(): List<Recommendation> =
        HabitJson.decodeFromString(RecommendationsPage.serializer(), check(call("GET", "/api/recommendations?status=pending"))).recommendations

    suspend fun acceptRecommendation(id: String) { check(call("POST", "/api/recommendations/$id/accept", "{}")) }
    suspend fun dismissRecommendation(id: String) { check(call("POST", "/api/recommendations/$id/dismiss", "{}")) }

    suspend fun createWatchLink(activityMap: Map<String, String>): IntegrationLink {
        val map: Map<String, JsonElement> = activityMap.mapValues { JsonPrimitive(it.value) }
        val b: String = buildJsonObject {
            put("provider", "galaxywatch")
            put("activity_map", JsonObject(map))
        }.toString()
        return HabitJson.decodeFromString(IntegrationLink.serializer(), check(call("POST", "/api/integrations/links", b)))
    }

    /** Sends one signed partner event. Returns the HTTP status (202 accepted, 200 duplicate). */
    suspend fun ingest(linkId: String, ingestKey: String, body: String): Int {
        val sig: String = HmacSigner.sign(body, ingestKey)
        val reply: Reply = call("POST", "/api/integrations/ingest/$linkId", body, mapOf("X-HabitLoop-Signature" to sig), auth = false)
        check(reply)
        return reply.code
    }
}
