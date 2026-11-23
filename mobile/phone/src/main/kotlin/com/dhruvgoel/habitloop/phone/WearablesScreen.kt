package com.dhruvgoel.habitloop.phone

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.dhruvgoel.habitloop.shared.*
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WearablesScreen(api: HabitApi, store: TokenStore) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var events by remember { mutableStateOf<List<PartnerEvent>>(emptyList()) }
    var logs by remember { mutableStateOf<List<ActivityLog>>(emptyList()) }
    var refreshing by remember { mutableStateOf(false) }
    var pairing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Connect your Wear OS watch to sync workouts and daily steps.") }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshedAt by remember { mutableStateOf<String?>(null) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    suspend fun reload() {
        if (refreshing) return
        refreshing = true
        val failures = mutableListOf<String>()
        try {
            val received = mutableListOf<PartnerEvent>()
            try {
                api.links().filter { it.provider == "galaxywatch" }.forEach { link ->
                    try { received += api.events(link.id) }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { failures += "Some integration events could not be loaded" }
                }
                events = (received + if (failures.isEmpty()) emptyList() else events).distinctBy { it.eventId }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { failures += "Integration events unavailable" }
            val activityLogs = mutableListOf<ActivityLog>()
            try {
                api.activities().forEach { activity ->
                    try { activityLogs += api.logs(activity.id).filter { it.source == "partner" && it.metadata.text("provider") == "galaxywatch" }.map { log ->
                        log.copy(metadata = JsonObject(mapOf("provider_activity" to JsonPrimitive(activity.name)) + log.metadata))
                    } }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { failures += "Some activity logs could not be loaded" }
                }
                logs = (activityLogs + if (failures.isEmpty()) emptyList() else logs).distinctBy { it.id }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { failures += "Activity logs unavailable" }
            error = failures.distinct().joinToString(". ").ifBlank { null }
            if (failures.isEmpty()) refreshedAt = Instant.now().toString()
        } finally { refreshing = false }
    }
    LaunchedEffect(api, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { reload(); delay(15_000) }
        }
    }
    val workouts = WearableStats.workouts(events, logs)
    val lastSync = (events.map { it.receivedAt } + logs.map { it.loggedAt })
        .mapNotNull { WearableStats.instant(it) }.maxOrNull()?.toString()
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { reload() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Text("Wearable", style = MaterialTheme.typography.titleLarge)
                Button(enabled = !pairing, onClick = {
                    pairing = true; status = "Checking connected wearables..."
                    scope.launch {
                        try {
                            val name = withTimeout(30_000) { WatchPairing.pair(context, api, store) { status = it } }
                            status = "Pairing sent to $name. Open HabitLoop on the watch."
                        } catch (e: kotlinx.coroutines.TimeoutCancellationException) { status = "Pairing timed out. Check the watch connection and retry." }
                        catch (e: CancellationException) { throw e }
                        catch (e: Exception) { status = e.message ?: "Pairing failed. Please retry." }
                        finally { pairing = false }
                    }
                }) { Text(if (pairing) "Pairing..." else "Re-pair wearable") }
                if (pairing) LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(status)
                Text("Today's steps: ${WearableStats.todaySteps(events, logs)?.toString() ?: "No data yet"}", style = MaterialTheme.typography.titleMedium)
                Text("Last sync: ${lastSync?.let { WearableStats.displayTime(it) } ?: "No sync yet"}")
                Text("Last refreshed: ${refreshedAt?.let { WearableStats.displayTime(it) } ?: "Not refreshed"}")
                Text("Refreshes every 15 seconds while visible. Pull down to refresh.", style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !refreshing, onClick = { scope.launch { reload() } }) { Text("Refresh now") }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Text("Events by status (latest 50 per link)", style = MaterialTheme.typography.titleMedium)
                Text(listOf("received", "normalized", "rejected").joinToString(" | ") { s -> "$s: ${events.count { it.status == s }}" })
                TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Hide event details" else "Show event details") }
            }
            if (expanded) items(events, key = { it.id }) {
                Text("${it.status}: ${it.payload.text("provider_activity") ?: it.payload.text("type") ?: "Event"} | ${WearableStats.displayTime(it.receivedAt)}${it.reason?.let { reason -> ": $reason" } ?: ""}")
            }
            item {
                Text("Recent workouts", style = MaterialTheme.typography.titleMedium)
                if (workouts.isEmpty()) Text("No recent watch workouts in this community.")
            }
            items(workouts, key = { it.eventId }) { workout ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(workout.type.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium)
                        Text("Duration: ${workout.duration} min | Steps: ${workout.steps}")
                        Text("Average heart rate: ${workout.heartRate} bpm")
                        Text(WearableStats.displayTime(workout.time))
                    }
                }
            }
        }
    }
}
