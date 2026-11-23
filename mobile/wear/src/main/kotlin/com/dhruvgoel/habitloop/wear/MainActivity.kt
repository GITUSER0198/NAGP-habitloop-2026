package com.dhruvgoel.habitloop.wear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerCallback
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.PassiveMonitoringClient
import androidx.health.services.client.data.PassiveListenerConfig
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CardDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TitleCard
import com.dhruvgoel.habitloop.shared.ActivityMap
import com.dhruvgoel.habitloop.shared.ApiException
import com.dhruvgoel.habitloop.shared.PairingPayload
import com.dhruvgoel.habitloop.shared.Summary
import com.dhruvgoel.habitloop.shared.TimeFmt
import com.dhruvgoel.habitloop.shared.TodayItem
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await as taskAwait

private val Teal: Color = Color(0xFF5DCAA5)
private val Amber: Color = Color(0xFFFAC775)
private val Navy: Color = Color(0xFF042C53)
private val NavyLight: Color = Color(0xFF0C447C)
private val TextMain: Color = Color(0xFFF1EFE8)
private val TextMuted: Color = Color(0xFFB4B2A9)
private val Danger: Color = Color(0xFFE24B4A)
private val Near: Color = Color(0xFF05080D)

private val WearColors: ColorScheme = ColorScheme(
    primary = Teal, onPrimary = Color(0xFF04342C),
    primaryContainer = NavyLight, onPrimaryContainer = TextMain,
    secondary = Amber, onSecondary = Color(0xFF3B2A05),
    secondaryContainer = Navy, onSecondaryContainer = TextMain,
    tertiary = Color(0xFF85B7EB), onTertiary = Color(0xFF042C53),
    surfaceContainer = Navy, surfaceContainerLow = Navy, surfaceContainerHigh = NavyLight,
    onSurface = TextMain, onSurfaceVariant = TextMuted,
    outline = NavyLight, outlineVariant = NavyLight,
    background = Near, onBackground = TextMain,
    error = Danger, onError = Color.White
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
            MaterialTheme(colorScheme = WearColors) {
                AppScaffold(Modifier.background(Near)) { WearApp() }
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
            delay(2000)
            paired = session.isPaired
        }
    }
    BackHandler(enabled = screen == "workouts" || screen == "settings") { screen = "home" }
    when {
        screen == "permissions" -> PermissionsScreen { launcher.launch(RUNTIME_PERMISSIONS) }
        !paired || screen == "signin" -> SignInScreen(session, showBack = paired) { paired = session.isPaired; screen = "home" }
        screen == "workouts" -> WorkoutScreen(context) { screen = "home" }
        screen == "settings" -> SettingsScreen(session, onBack = { screen = "home" }, onSignOut = { session.store.clear(); paired = false; screen = "home" })
        else -> HomeScreen(session, onWorkouts = { screen = "workouts" }, onSettings = { screen = "settings" })
    }
}

// ---------- shared building blocks ----------

@Composable
private fun ListScreen(content: TransformingLazyColumnScope.() -> Unit) {
    val state = rememberTransformingLazyColumnState()
    ScreenScaffold(scrollState = state) { padding ->
        TransformingLazyColumn(state = state, contentPadding = padding, modifier = Modifier.fillMaxSize()) { content() }
    }
}

@Composable
private fun Title(text: String, color: Color = Teal) {
    Text(text, color = color, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp))
}

@Composable
private fun Body(text: String, color: Color = TextMain) {
    Text(text, color = color, fontSize = 13.sp, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp))
}

@Composable
private fun IconBadge(icon: ImageVector, tint: Color, bg: Color, size: Dp = 32.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(size * 0.6f))
    }
}

@Composable
private fun NavButton(label: String, icon: ImageVector, primary: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    if (primary) {
        Button(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(),
            icon = { Icon(icon, null, Modifier.size(22.dp)) },
            label = { Text(label, fontSize = 14.sp, maxLines = 1) })
    } else {
        FilledTonalButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(),
            icon = { Icon(icon, null, Modifier.size(22.dp)) },
            label = { Text(label, fontSize = 14.sp, maxLines = 1) })
    }
}

@Composable
private fun StateMessage(icon: ImageVector, tint: Color, text: String) {
    Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(36.dp))
        Text(text, color = TextMain, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
    }
}

private fun categoryIcon(category: String): ImageVector = when (category.lowercase()) {
    "fitness" -> Icons.Filled.DirectionsRun
    "learning", "study", "reading" -> Icons.Filled.MenuBook
    "health", "wellness" -> Icons.Filled.Favorite
    "mindfulness", "mind", "mental" -> Icons.Filled.Psychology
    "social", "family", "community" -> Icons.Filled.Groups
    else -> Icons.Filled.FitnessCenter
}

// ---------- permissions and sign-in ----------

@Composable
private fun PermissionsScreen(onContinue: () -> Unit) {
    ListScreen {
        item { Title("HabitLoop needs") }
        item { Body("Body sensors: heart rate during workouts.") }
        item { Body("Activity recognition: steps and workout type.") }
        item { Body("Notifications: habit reminders.") }
        item { NavButton("Continue", Icons.Filled.Check, true, onClick = onContinue) }
    }
}

@Composable
private fun SignInScreen(session: Session, showBack: Boolean, onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Open HabitLoop on the phone and press Pair wearable (Wearables tab), or sign in here.") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    ListScreen {
        item { Title("Sign in") }
        item { Body(status) }
        item { Field("Email", email, KeyboardType.Email, VisualTransformation.None) { email = it.replace(" ", "") } }
        item { Field("Password", password, KeyboardType.Password, PasswordVisualTransformation()) { password = it } }
        item {
            Button(modifier = Modifier.fillMaxWidth(), enabled = !busy && email.isNotBlank() && password.isNotEmpty(), onClick = {
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
            }, label = { Text(if (busy) "Please wait" else "Sign in", fontSize = 14.sp) })
        }
        if (showBack) item { FilledTonalButton(onClick = onDone, modifier = Modifier.fillMaxWidth(), label = { Text("Back", fontSize = 14.sp) }) }
    }
}

@Composable
private fun Field(label: String, value: String, type: KeyboardType, transform: VisualTransformation, onChange: (String) -> Unit) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp).background(NavyLight, RoundedCornerShape(16.dp)).padding(12.dp)) {
        if (value.isEmpty()) Text(label, color = TextMuted, fontSize = 14.sp)
        BasicTextField(
            value, onChange, singleLine = true,
            textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
            cursorBrush = SolidColor(Teal),
            keyboardOptions = KeyboardOptions(keyboardType = type, autoCorrectEnabled = false),
            visualTransformation = transform
        )
    }
}

// ---------- today ----------

@Composable
private fun StatusChip(status: String?) {
    val (label: String, fg: Color, bg: Color) = when (status) {
        null -> Triple("To do", Color(0xFF3B2A05), Amber)
        "missed" -> Triple("Missed", TextMuted, Color(0xFF2C3440))
        "completed" -> Triple("Completed", Color(0xFF04342C), Teal)
        else -> Triple("Done", Color(0xFF04342C), Teal)
    }
    Text(label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
private fun HomeScreen(session: Session, onWorkouts: () -> Unit, onSettings: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var today by remember { mutableStateOf<List<TodayItem>>(emptyList()) }
    var summary by remember { mutableStateOf<Summary?>(null) }
    var info by remember { mutableStateOf("Loading...") }
    var failed by remember { mutableStateOf(false) }
    var logging by remember { mutableStateOf<TodayItem?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        try {
            today = session.authed { it.today() }
            summary = try { session.authed { it.summary() } } catch (e: Exception) { null }
            failed = false
            info = if (today.isEmpty()) "No habits today" else ""
            Log.i(WEAR_TAG, "today loaded: ${today.size} habits")
        } catch (e: Exception) {
            failed = true
            info = "Offline: ${e.message ?: e.javaClass.simpleName}"
        }
    }
    LaunchedEffect(Unit) { reload() }

    val item: TodayItem? = logging
    if (item != null) {
        LogScreen(item, onLog = { s -> runCatching { session.authed { it.logActivity(item.id, s) } }.isSuccess },
            onClose = { logging = null; scope.launch { reload() } })
        return
    }

    val loggedCount: Int = today.count { it.status != null }
    val progress: Float = if (today.isEmpty()) 0f else loggedCount.toFloat() / today.size
    Box(Modifier.fillMaxSize()) {
        CircularProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxSize().padding(2.dp),
            strokeWidth = 6.dp,
            colors = ProgressIndicatorDefaults.colors(indicatorColor = Teal, trackColor = Color(0xFF16263A))
        )
        ListScreen {
            item {
                Column(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$loggedCount of ${today.size} done", color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                        Icon(Icons.Filled.LocalFireDepartment, null, tint = Amber, modifier = Modifier.size(18.dp))
                        Text(" ${summary?.currentStreak ?: 0} day streak", color = Amber, fontSize = 14.sp)
                    }
                }
            }
            if (info.isNotEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(if (failed) Icons.Filled.CloudOff else Icons.Filled.EventAvailable, null,
                        tint = if (failed) Danger else TextMuted, modifier = Modifier.size(30.dp))
                    Body(info, TextMuted)
                }
            }
            today.forEach { h ->
                item {
                    TitleCard(
                        onClick = { logging = h },
                        title = { Text(h.name, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        subtitle = { Text(TimeFmt.to12h(h.preferredTime), fontSize = 13.sp, color = TextMuted) },
                        time = { IconBadge(categoryIcon(h.category), Teal, NavyLight, 28.dp) },
                        colors = CardDefaults.cardColors(),
                        modifier = Modifier.fillMaxWidth()
                    ) { StatusChip(h.status) }
                }
            }
            item { Spacer8() }
            item { NavButton("Start workout", Icons.Filled.DirectionsRun, true, onClick = onWorkouts) }
            item {
                NavButton("Sync steps", Icons.Filled.Sync, false) {
                    scope.launch {
                        val steps: Long = StepsTracker.dailySteps
                        if (steps < 0) { info = "No step data yet"; return@launch }
                        Sender.sendSteps(context, steps.toInt())
                        info = "Steps: ${WorkoutState.message.value}"
                    }
                }
            }
            item { NavButton("Refresh", Icons.Filled.Refresh, false) { scope.launch { reload() } } }
            item { NavButton("Settings", Icons.Filled.Settings, false, onClick = onSettings) }
            item { Spacer8() }
        }
    }
}

@Composable
private fun Spacer8() {
    Box(Modifier.size(8.dp))
}

@Composable
private fun LogButton(label: String, icon: ImageVector, bg: Color, fg: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        androidx.wear.compose.material3.IconButton(
            onClick = onClick, modifier = Modifier.size(54.dp),
            colors = androidx.wear.compose.material3.IconButtonDefaults.iconButtonColors(containerColor = bg, contentColor = fg)
        ) { Icon(icon, label, modifier = Modifier.size(30.dp)) }
        Text(label, color = TextMain, fontSize = 12.sp, maxLines = 1, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun LogScreen(item: TodayItem, onLog: suspend (String) -> Boolean, onClose: () -> Unit) {
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }
    val scale = remember { Animatable(0.3f) }
    val scope = rememberCoroutineScope()
    BackHandler { onClose() }
    LaunchedEffect(result) {
        if (result != null) {
            scale.snapTo(0.3f)
            scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
            delay(900)
            onClose()
        }
    }
    ScreenScaffold {
        val r: String? = result
        if (r != null) {
            val tint: Color = if (!ok) Danger else if (r == "missed") TextMuted else Teal
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Close, null, tint = tint,
                    modifier = Modifier.size(64.dp).scale(scale.value))
                Text(if (ok) "Logged" else "Not saved", color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 6.dp))
            }
        } else {
            Column(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally) {
                Text(item.name, color = Teal, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                Text(TimeFmt.to12h(item.preferredTime), color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    LogButton("Done", Icons.Filled.Check, Teal, Color(0xFF04342C)) { scope.launch { ok = onLog("done"); result = "done" } }
                    LogButton("Completed", Icons.Filled.DoneAll, NavyLight, Teal) { scope.launch { ok = onLog("completed"); result = "completed" } }
                    LogButton("Missed", Icons.Filled.Close, Color(0xFF2C3440), TextMain) { scope.launch { ok = onLog("missed"); result = "missed" } }
                }
            }
        }
    }
}

// ---------- settings ----------

@Composable
private fun SettingsScreen(session: Session, onBack: () -> Unit, onSignOut: () -> Unit) {
    val name: String = session.store.userName.ifBlank { "HabitLoop" }
    ListScreen {
        item { Title("Settings") }
        item {
            TitleCard(onClick = {}, title = { Text(name, fontSize = 16.sp, maxLines = 2) },
                subtitle = { Text("Signed in as", fontSize = 13.sp, color = TextMuted) },
                time = { IconBadge(Icons.Filled.Groups, Teal, NavyLight, 28.dp) },
                modifier = Modifier.fillMaxWidth()) { }
        }
        item { NavButton("Sign out", Icons.AutoMirrored.Filled.Logout, true, onClick = onSignOut) }
        item { NavButton("Back", Icons.Filled.Check, false, onClick = onBack) }
    }
}

// ---------- workout ----------

private fun elapsedText(startedAt: Instant?, now: Instant): String {
    if (startedAt == null) return "0:00"
    val d: Duration = Duration.between(startedAt, now).let { if (it.isNegative) Duration.ZERO else it }
    val total: Long = d.seconds
    val h: Long = total / 3600
    val m: Long = (total % 3600) / 60
    val s: Long = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

private fun kindIcon(kind: String): ImageVector = when (kind) {
    "run" -> Icons.Filled.DirectionsRun
    "cycle" -> Icons.Filled.DirectionsBike
    else -> Icons.Filled.DirectionsWalk
}

@Composable
private fun WorkoutScreen(context: Context, onBack: () -> Unit) {
    val phase by WorkoutState.phase.collectAsState()
    val steps by WorkoutState.steps.collectAsState()
    val hr by WorkoutState.heartRate.collectAsState()
    val message by WorkoutState.message.collectAsState()
    val kind by WorkoutState.kind.collectAsState()
    val startedAt by WorkoutState.startedAt.collectAsState()
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(phase) {
        while (phase == "running") { now = Instant.now(); delay(1000) }
    }
    when (phase) {
        "running" -> ScreenScaffold {
            Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(kindIcon(kind), null, tint = Teal, modifier = Modifier.size(16.dp))
                    Text(" " + kind.replaceFirstChar { it.uppercase() }, color = Teal, fontSize = 14.sp)
                }
                Text(elapsedText(startedAt, now), color = TextMain, fontSize = 38.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Favorite, null, tint = Danger, modifier = Modifier.size(18.dp))
                        Text(" " + (if (hr > 0) hr.toInt().toString() else "--"), color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.DirectionsWalk, null, tint = Teal, modifier = Modifier.size(18.dp))
                        Text(" $steps", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                Button(onClick = { ExerciseService.stop(context) }, modifier = Modifier.padding(top = 8.dp).fillMaxWidth(0.7f),
                    colors = ButtonDefaults.buttonColors(containerColor = Danger, contentColor = Color.White),
                    icon = { Icon(Icons.Filled.Stop, null, Modifier.size(22.dp)) },
                    label = { Text("End", fontSize = 16.sp) })
            }
        }
        "sending" -> ScreenScaffold { StateMessage(Icons.Filled.Send, Amber, "Sending...") }
        "sent" -> ScreenScaffold { StateMessage(Icons.Filled.Send, Teal, "Sent. Waiting to be logged...") }
        "logged" -> ListScreenState(Icons.Filled.CheckCircle, Teal, "Logged", onBack)
        "failed" -> ListScreenState(Icons.Filled.CloudOff, Danger, message.ifBlank { "Something went wrong" }, onBack)
        else -> ListScreen {
            item { Title("Start workout") }
            listOf(Triple("walk", "Walk", Icons.Filled.DirectionsWalk), Triple("run", "Run", Icons.Filled.DirectionsRun),
                Triple("cycle", "Cycle", Icons.Filled.DirectionsBike)).forEach { (k, l, ic) ->
                item { NavButton(l, ic, true) { WorkoutState.message.value = ""; ExerciseService.start(context, k) } }
            }
            item { NavButton("Back", Icons.Filled.Check, false, onClick = onBack) }
        }
    }
}

@Composable
private fun ListScreenState(icon: ImageVector, tint: Color, text: String, onBack: () -> Unit) {
    ListScreen {
        item { Spacer8() }
        item {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(44.dp))
                Text(text, color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp, start = 8.dp, end = 8.dp))
            }
        }
        item { NavButton("New workout", Icons.Filled.DirectionsRun, true) { WorkoutState.phase.value = "idle"; WorkoutState.message.value = "" } }
        item { NavButton("Back", Icons.Filled.Check, false, onClick = onBack) }
    }
}
