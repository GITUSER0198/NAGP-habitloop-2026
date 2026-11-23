package com.dhruvgoel.habitloop.shared

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.Json

val HabitJson: Json = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = true
}

@Serializable
data class User(val id: String = "", val name: String = "", val email: String = "")

@Serializable
data class CommunityRef(val id: String = "", val name: String = "", val kind: String = "")

@Serializable
data class AuthResponse(val token: String, val user: User = User(), val community: CommunityRef = CommunityRef())

@Serializable
data class MyCommunity(
    val id: String,
    val name: String,
    val kind: String = "community",
    val description: String = "",
    val role: String = "member",
    @SerialName("member_count") val memberCount: Int = 0,
    val active: Boolean = false
)

@Serializable
data class Activity(
    val id: String,
    val name: String,
    val category: String = "other",
    @SerialName("preferred_time") val preferredTime: String = "09:00",
    val active: Boolean = true
)

@Serializable
data class TodayItem(
    val id: String,
    val name: String,
    val category: String = "other",
    @SerialName("preferred_time") val preferredTime: String = "09:00",
    val status: String? = null,
    @SerialName("due_at") val dueAt: String = ""
)

@Serializable
data class DayCounts(val date: String = "", val done: Int = 0, val completed: Int = 0, val missed: Int = 0)

@Serializable
data class Summary(
    val today: DayCounts = DayCounts(),
    @SerialName("rate_7d") val rate7d: Double = 0.0,
    @SerialName("current_streak") val currentStreak: Int = 0,
    @SerialName("best_streak") val bestStreak: Int = 0
)

@Serializable
data class WallChallenge(
    val id: String = "", val title: String = "",
    val description: String = "", val visibility: String = "public",
    @SerialName("start_date") val startDate: String = "",
    @SerialName("end_date") val endDate: String = "",
    @SerialName("target_count") val targetCount: Int = 0
)

@Serializable
data class WallCommunity(val id: String = "", val name: String = "")

@Serializable
data class WallPost(
    val id: String,
    @SerialName("author_name") val authorName: String = "",
    val caption: String = "",
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    val challenge: WallChallenge = WallChallenge(),
    val community: WallCommunity = WallCommunity(),
    @SerialName("caring_value") val caringValue: String? = null,
    @SerialName("participant_count") val participantCount: Int = 0,
    @SerialName("latest_comments") val latestComments: List<WallComment> = emptyList(),
    @SerialName("like_count") val likeCount: Int = 0,
    @SerialName("liked_by_me") val likedByMe: Boolean = false,
    @SerialName("comment_count") val commentCount: Int = 0,
    @SerialName("challenge_id") val challengeId: String = "",
    @SerialName("joined_by_me") val joinedByMe: Boolean = false,
    @SerialName("owned_by_me") val ownedByMe: Boolean = false
)

@Serializable
data class WallPage(val posts: List<WallPost> = emptyList(), @SerialName("next_cursor") val nextCursor: String? = null)

@Serializable
data class WallComment(
    val id: String,
    @SerialName("author_name") val authorName: String = "",
    val body: String = ""
)

@Serializable
data class Recommendation(
    val id: String,
    @SerialName("activity_id") val activityId: String = "",
    val kind: String = "",
    @SerialName("current_value") val currentValue: JsonElement? = null,
    @SerialName("suggested_value") val suggestedValue: JsonElement? = null,
    val reason: String = "",
    val status: String = "pending"
)

@Serializable
data class IntegrationLink(
    val id: String,
    val provider: String = "",
    val status: String = "",
    @SerialName("ingest_key") val ingestKey: String? = null
)

@Serializable
data class ActivityLog(
    val id: String = "",
    val status: String = "",
    @SerialName("logged_at") val loggedAt: String = "",
    val source: String = "",
    @SerialName("source_event_id") val sourceEventId: String? = null,
    @SerialName("duration_min") val durationMin: Int? = null,
    val metadata: JsonObject = JsonObject(emptyMap())
)

/** Sent from the phone to the watch over the Wearable Data Layer. */
@Serializable
data class PairingPayload(
    @SerialName("link_id") val linkId: String,
    @SerialName("ingest_key") val ingestKey: String,
    @SerialName("base_url") val baseUrl: String,
    val token: String,
    @SerialName("activity_map") val activityMap: Map<String, String> = emptyMap(),
    @SerialName("user_name") val userName: String = "",
    // Kept so the watch can sign in again when the 60 minute token expires. Travels only over the paired Data Layer.
    val email: String = "",
    val password: String = ""
)

object Pairing {
    const val PATH = "/habitloop/pairing"
    const val KEY_JSON = "payload"
}

@Serializable
data class Organization(val domain: String = "")

@Serializable
data class Account(
    val name: String = "", val email: String = "",
    val organization: Organization? = null,
    val community: CommunityRef = CommunityRef()
)

@Serializable
data class RecommendationsPage(val recommendations: List<Recommendation> = emptyList())

@Serializable
data class LeaderboardEntry(val name: String = "Member", val rank: Int = 0, val count: Int = 0, val target: Int = 0)

@Serializable
data class ChallengeProgress(val leaderboard: List<LeaderboardEntry> = emptyList())

@Serializable
data class PartnerEvent(
    val id: String = "",
    @SerialName("link_id") val linkId: String = "",
    @SerialName("event_id") val eventId: String = "",
    val status: String = "",
    val reason: String? = null,
    @SerialName("received_at") val receivedAt: String = "",
    val payload: JsonObject = JsonObject(emptyMap())
)
