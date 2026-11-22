package com.dhruvgoel.habitloop.wear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerCallback
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.PassiveMonitoringClient
import androidx.health.services.client.data.PassiveListenerConfig
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.dhruvgoel.habitloop.shared.ActivityMap
import com.dhruvgoel.habitloop.shared.ApiException
import com.dhruvgoel.habitloop.shared.PairingPayload
import com.dhruvgoel.habitloop.shared.Summary
import com.dhruvgoel.habitloop.shared.TimeFmt
import com.dhruvgoel.habitloop.shared.TodayItem
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await as taskAwait

private val WearColors: Colors = Colors(
    primary = Color(0xFF5DCAA5),
    onPrimary = Color(0xFF04342C),
    surface = Color(0xFF042C53),
    onSurface = Color(0xFFF1EFE8),
    background = Color(0xFF000000),
    onBackground = Color(0xFFF1EFE8),
    error = Color(0xFFF09595)
)

/** Daily steps from Health Services passive monitoring; the latest value is kept for "Sync steps". */
object StepsTracker {
    @Volatile var dailySteps: Long = -1

    fun start(context: Context) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) return
        val client: PassiveMonitoringClient = HealthServices.getClient(context).passiveMonitoringClient
        val config: PassiveListenerConfig = PassiveListenerConfig.builder()
            .setDataTypes(setOf(DataType.STEPS_DAILY))
            .build()
        client.setPassiveListenerCallback(config, object : PassiveListenerCallback {
            override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
                dataPoints.getData(DataType.STEPS_DAILY).lastOrNull()?.let { dailySteps = it.value }
            }
        })
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ReminderWorker.schedule(applicationContext)
        setContent {
            MaterialTheme(colors = WearColors) {
                Box(Modifier.fillMaxSize().background(Color.Black)) { WearApp() }
            }
        }
    }
}

private val RUNTIME_PERMISSIONS: Array<String> = arrayOf(
    Manifest.permission.BODY_SENSORS,
    Manifest.permission.ACTIVITY_RECOGNITION,
    Manifest.permission.POST_NOTIFICATIONS
)

private fun permissionsMissing(context: Context): Boolean =
    RUNTIME_PERMISSIONS.any { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }

@Composable
fun WearApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val session: Session = remember { Session.get(context) }
    var paired by remember { mutableStateOf(session.isPaired) }
    var screen by remember { mutableStateOf(if (permissionsMissing(context) && !session.store.userName.equals("__skip__")) "permissions" else "home") }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        screen = "home"
        StepsTracker.start(context)
    }
    LaunchedEffect(Unit) {
        StepsTracker.start(context)
        if (!paired) {
            val got: Boolean = try { PairingReader.pullExisting(context) } catch (e: Exception) { false }
            paired = got || session.isPaired
        }
    }
    // Pairing can also arrive later through PairingService.
    LaunchedEffect(paired, screen) {
        while (!paired) {
            kotlinx.coroutines.delay(2000)
            paired = session.isPaired
        }
    }
    when {
        screen == "permissions" -> PermissionsScreen { launcher.launch(RUNTIME_PERMISSIONS) }
        !paired || screen == "signin" -> SignInScreen(session, showBack = paired) { paired = session.isPaired; screen = "home" }
        screen == "workouts" -> WorkoutScreen(context) { screen = "home" }
        else -> HomeScreen(session, onWorkouts = { screen = "workouts" }, onSignOut = { session.store.clear(); paired = false })
    }
}

@Composable
private fun PermissionsScreen(onContinue: () -> Unit) {
    ScalingLazyColumn(Modifier.fillMaxSize()) {
        item { Text("HabitLoop needs", color = MaterialTheme.colors.primary) }
        item { Text("Body sensors: heart rate during workouts.", Modifier.padding(horizontal = 12.dp)) }
        item { Text("Activity recognition: steps and workout type.", Modifier.padding(horizontal = 12.dp)) }
        item { Text("Notifications: habit reminders.", Modifier.padding(horizontal = 12.dp)) }
        item { Chip(onClick = onContinue, label = { Text("Continue") }) }
    }
}

@Composable
private fun SignInScreen(session: Session, showBack: Boolean, onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Open HabitLoop on the phone and press Pair Galaxy Watch, or sign in here.") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    ScalingLazyColumn(Modifier.fillMaxSize()) {
        item { Text("Sign in", color = MaterialTheme.colors.primary) }
        item { Text(status, Modifier.padding(horizontal = 14.dp), color = MaterialTheme.colors.onBackground) }
        item { Field("Email", email, KeyboardType.Email, VisualTransformation.None) { email = it.replace(" ", "") } }
        item { Field("Password", password, KeyboardType.Password, PasswordVisualTransformation()) { password = it } }
        item {
            Chip(enabled = !busy && email.isNotBlank() && password.isNotEmpty(), onClick = {
                busy = true; status = "Signing in..."
                scope.launch {
                    try {
                        val em: String = email.trim().lowercase()
                        val auth = session.api.login(em, password)
                        session.store.token = auth.token
                        val acts = session.api.activities()
                        val map: Map<String, String> = ActivityMap.build(acts)
                        if (map.isEmpty()) throw ApiException(0, "Create a habit first")
                        val link = session.api.createWatchLink(map)
                        session.apply(PairingPayload(
                            linkId = link.id, ingestKey = link.ingestKey ?: "", baseUrl = BuildConfig.API_BASE_URL,
                            token = auth.token, activityMap = map, userName = auth.user.name, email = em, password = password
                        ))
                        Log.i(WEAR_TAG, "signed in on watch")
                        onDone()
                    } catch (e: ApiException) {
                        status = e.message ?: "Failed"
                    } catch (e: Exception) {
                        status = "Cannot reach the server"
                    }
                    busy = false
                }
            }, label = { Text(if (busy) "Please wait" else "Sign in") })
        }
        if (showBack) item { Chip(onClick = onDone, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors()) }
    }
}

@Composable
private fun Field(label: String, value: String, type: KeyboardType, transform: VisualTransformation, onChange: (String) -> Unit) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).background(Color(0xFF0C447C), androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).padding(10.dp)) {
        if (value.isEmpty()) Text(label, color = Color(0xFFB4B2A9))
        BasicTextField(
            value, onChange, singleLine = true,
            textStyle = TextStyle(color = Color(0xFFF1EFE8)),
            cursorBrush = SolidColor(Color(0xFF5DCAA5)),
            keyboardOptions = KeyboardOptions(keyboardType = type, autoCorrectEnabled = false),
            visualTransformation = transform
        )
    }
}

@Composable
private fun HomeScreen(session: Session, onWorkouts: () -> Unit, onSignOut: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var today by remember { mutableStateOf<List<TodayItem>>(emptyList()) }
    var summary by remember { mutableStateOf<Summary?>(null) }
    var info by remember { mutableStateOf("Loading...") }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        try {
            today = session.authed { it.today() }
            summary = try { session.authed { it.summary() } } catch (e: Exception) { null }
            info = if (today.isEmpty()) "No habits today" else ""
            Log.i(WEAR_TAG, "today loaded: ${today.size} habits")
        } catch (e: Exception) {
            info = "Offline: ${e.message ?: e.javaClass.simpleName}"
        }
    }
    LaunchedEffect(Unit) { reload() }
    val loggedCount: Int = today.count { it.status != null }
    val progress: Float = if (today.isEmpty()) 0f else loggedCount.toFloat() / today.size
    ScalingLazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(progress = progress, modifier = Modifier.fillMaxSize(), strokeWidth = 5.dp)
                Text("$loggedCount/${today.size}")
            }
        }
        item { Text("Streak ${summary?.currentStreak ?: 0} days", color = MaterialTheme.colors.primary) }
        if (info.isNotEmpty()) item { Text(info, Modifier.padding(horizontal = 14.dp)) }
        today.forEach { h ->
            item {
                var open by remember { mutableStateOf(false) }
                Chip(onClick = { open = !open },
                    label = { Text(h.name, maxLines = 1) },
                    secondaryLabel = { Text(TimeFmt.to12h(h.preferredTime) + "  " + (h.status ?: "to do")) },
                    modifier = Modifier.fillMaxWidth())
                if (open) {
                    listOf("done" to "Done", "completed" to "Completed", "missed" to "Missed").forEach { (s, l) ->
                        Chip(onClick = { scope.launch { runCatching { session.authed { it.logActivity(h.id, s) } }; open = false; reload() } },
                            label = { Text(l) }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
        item { Chip(onClick = onWorkouts, label = { Text("Workouts") }, modifier = Modifier.fillMaxWidth()) }
        item {
            Chip(onClick = {
                scope.launch {
                    val steps: Long = StepsTracker.dailySteps
                    if (steps < 0) { info = "No step data yet"; return@launch }
                    Sender.sendSteps(context, steps.toInt())
                    info = "Steps: ${WorkoutState.message.value}"
                }
            }, label = { Text("Sync steps") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
        }
        item { Chip(onClick = { scope.launch { reload() } }, label = { Text("Refresh") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
        item { Chip(onClick = onSignOut, label = { Text("Sign out") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
    }
}

@Composable
private fun WorkoutScreen(context: Context, onBack: () -> Unit) {
    val phase by WorkoutState.phase.collectAsState()
    val steps by WorkoutState.steps.collectAsState()
    val hr by WorkoutState.heartRate.collectAsState()
    val message by WorkoutState.message.collectAsState()
    val kind by WorkoutState.kind.collectAsState()
    ScalingLazyColumn(Modifier.fillMaxSize()) {
        item { Text("Workouts", color = MaterialTheme.colors.primary) }
        if (phase == "running") {
            item { Text("$kind: $steps steps, ${hr.toInt()} bpm") }
            item { Chip(onClick = { ExerciseService.stop(context) }, label = { Text("End") }, modifier = Modifier.fillMaxWidth()) }
        } else {
            if (message.isNotEmpty()) item { Text(message, Modifier.padding(horizontal = 14.dp)) }
            if (phase == "sending") item { Text("Sending...") }
            listOf("walk" to "Start Walk", "run" to "Start Run", "cycle" to "Start Cycle").forEach { (k, l) ->
                item {
                    Chip(enabled = phase != "sending", onClick = { WorkoutState.message.value = ""; ExerciseService.start(context, k) },
                        label = { Text(l) }, modifier = Modifier.fillMaxWidth())
                }
            }
            item { Chip(onClick = onBack, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
        }
    }
}
