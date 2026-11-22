package com.dhruvgoel.habitloop.phone

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dhruvgoel.habitloop.shared.ApiException
import com.dhruvgoel.habitloop.shared.DayCounts
import com.dhruvgoel.habitloop.shared.HabitApi
import com.dhruvgoel.habitloop.shared.MyCommunity
import com.dhruvgoel.habitloop.shared.Recommendation
import com.dhruvgoel.habitloop.shared.Summary
import com.dhruvgoel.habitloop.shared.TimeFmt
import com.dhruvgoel.habitloop.shared.TodayItem
import com.dhruvgoel.habitloop.shared.TokenStore
import com.dhruvgoel.habitloop.shared.WallPost
import kotlinx.coroutines.launch

private const val TAG = "HabitLoop"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = TokenStore(applicationContext)
        val prefs = getSharedPreferences("ui", Context.MODE_PRIVATE)
        ReminderWorker.schedule(applicationContext)
        setContent {
            var dark by remember { mutableStateOf(prefs.getBoolean("dark", false)) }
            var token by remember { mutableStateOf(store.token) }
            val api: HabitApi = remember { HabitApi(BuildConfig.API_BASE_URL) { store.token } }
            HabitLoopTheme(dark) {
                val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                LaunchedEffect(Unit) {
                    if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
                    if (token == null) {
                        LoginScreen(api) { res, em, pw ->
                            store.email = em; store.password = pw
                            store.token = res.token
                            store.userName = res.user.name
                            Log.i(TAG, "login ok")
                            token = res.token
                        }
                    } else {
                        MainScaffold(api, store, dark, onDark = { dark = it; prefs.edit().putBoolean("dark", it).apply() }) {
                            store.clear(); token = null
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun LoginScreen(api: HabitApi, onDone: (com.dhruvgoel.habitloop.shared.AuthResponse, String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("HabitLoop", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
        Text(if (register) "Create your account" else "Sign in", Modifier.padding(bottom = 16.dp))
        if (register) {
            OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("name"))
        }
        OutlinedTextField(email, { email = it.replace(" ", "") }, label = { Text("Email") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().testTag("email"))
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag("password"))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Button(
            onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        val em: String = email.trim().lowercase()
                        onDone(if (register) api.register(em, password, name.trim()) else api.login(em, password), em, password)
                    } catch (e: ApiException) {
                        error = e.message
                    } catch (e: Exception) {
                        error = "Cannot reach the server"
                    }
                    busy = false
                }
            },
            enabled = !busy && email.isNotBlank() && password.isNotEmpty() && (!register || name.isNotBlank()),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
        ) { Text(if (busy) "Please wait" else if (register) "Register" else "Sign in") }
        TextButton(onClick = { register = !register; error = null }) {
            Text(if (register) "I already have an account" else "Create an account")
        }
    }
}

private enum class Tab(val label: String) { Home("Home"), Dashboard("Dashboard"), Tips("Tips"), Wearables("Watch") }

@Composable
fun MainScaffold(api: HabitApi, store: TokenStore, dark: Boolean, onDark: (Boolean) -> Unit, onLogout: () -> Unit) {
    var tab by remember { mutableStateOf(Tab.Home) }
    var communities by remember { mutableStateOf<List<MyCommunity>>(emptyList()) }
    var menu by remember { mutableStateOf(false) }
    var epoch by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(epoch) { runCatching { communities = api.communities() } }
    val active: MyCommunity? = communities.firstOrNull { it.active }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    TextButton(onClick = { menu = true }) { Text(active?.name ?: "Community", maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
                    DropdownMenu(menu, { menu = false }) {
                        communities.forEach { c ->
                            DropdownMenuItem(text = { Text(c.name + if (c.active) " (current)" else "") }, onClick = {
                                menu = false
                                scope.launch {
                                    runCatching { store.token = api.switchCommunity(c.id).token; epoch++ }
                                }
                            })
                        }
                    }
                }
                Switch(dark, onDark, Modifier.padding(horizontal = 4.dp))
                TextButton(onClick = onLogout) { Text("Sign out", maxLines = 1, softWrap = false) }
            }
        },
        bottomBar = {
            NavigationBar {
                Tab.values().forEach { t ->
                    NavigationBarItem(selected = tab == t, onClick = { tab = t }, icon = {}, label = { Text(t.label) },
                        modifier = Modifier.semantics { contentDescription = "tab-${t.label}" })
                }
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            key(epoch) {
                when (tab) {
                    Tab.Home -> HomeScreen(api)
                    Tab.Dashboard -> DashboardScreen(api)
                    Tab.Tips -> TipsScreen(api)
                    Tab.Wearables -> WearablesScreen(api, store)
                }
            }
        }
    }
}

@Composable
fun HomeScreen(api: HabitApi) {
    var posts by remember { mutableStateOf<List<WallPost>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var commentFor by remember { mutableStateOf<WallPost?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        try { posts = api.wall().posts; error = null; Log.i(TAG, "home wall loaded: ${posts.size} posts") }
        catch (e: Exception) { error = e.message ?: "Could not load" }
        loaded = true
    }
    LaunchedEffect(Unit) { reload() }
    Column(Modifier.fillMaxSize().semantics { contentDescription = "home-wall" }) {
        Text("Home wall", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(16.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
        if (loaded && posts.isEmpty() && error == null) Text("No posts yet in this community.", Modifier.padding(16.dp))
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(posts, key = { it.id }) { p ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(p.challenge.title, style = MaterialTheme.typography.titleMedium)
                        Text("by ${p.authorName}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        p.imageUrl?.let { url -> if (url.startsWith("/")) BuildConfig.WEB_BASE_URL.trimEnd('/') + url else url }?.let { RemoteImage(it, Modifier.fillMaxWidth().height(160.dp).padding(vertical = 8.dp)) }
                        Text(p.caption)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = { scope.launch { runCatching { api.like(p.id) }; reload() } }) {
                                Text((if (p.likedByMe) "Liked " else "Like ") + p.likeCount)
                            }
                            TextButton(onClick = { commentFor = p }) { Text("Comment ${p.commentCount}") }
                            when {
                                p.ownedByMe -> Text("Your challenge", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                                p.joinedByMe -> Text("Joined", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                                else -> TextButton(onClick = { scope.launch { runCatching { api.joinChallenge(p.challengeId) }; reload() } }) { Text("Join") }
                            }
                        }
                    }
                }
            }
        }
    }
    commentFor?.let { p -> CommentDialog(api, p) { commentFor = null; scope.launch { reload() } } }
}

@Composable
private fun CommentDialog(api: HabitApi, post: WallPost, onClose: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<String>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(post.id) { runCatching { items = api.comments(post.id).map { it.authorName + ": " + it.body } } }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Comments") },
        text = {
            Column {
                items.forEach { Text(it, Modifier.padding(vertical = 2.dp)) }
                OutlinedTextField(text, { text = it }, label = { Text("Add a comment") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(enabled = text.isNotBlank(), onClick = {
                scope.launch { runCatching { api.comment(post.id, text.trim()) }; onClose() }
            }) { Text("Post") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Close") } }
    )
}

@Composable
fun DashboardScreen(api: HabitApi) {
    var today by remember { mutableStateOf<List<TodayItem>>(emptyList()) }
    var summary by remember { mutableStateOf<Summary?>(null) }
    var strip by remember { mutableStateOf<List<DayCounts>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        try {
            today = api.today(); summary = api.summary(); strip = api.heatmap(14); error = null
        } catch (e: Exception) { error = e.message ?: "Could not load" }
    }
    LaunchedEffect(Unit) { reload() }
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Dashboard", style = MaterialTheme.typography.titleLarge)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            summary?.let {
                Text("Streak ${it.currentStreak} days (best ${it.bestStreak})  |  7-day rate ${(it.rate7d * 100).toInt()}%",
                    Modifier.padding(vertical = 8.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                strip.takeLast(14).forEach { d ->
                    val n: Int = d.done + d.completed
                    val shade: Float = when { n == 0 -> 0.08f; n == 1 -> 0.35f; n == 2 -> 0.6f; else -> 1f }
                    Box(Modifier.size(18.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = shade), RoundedCornerShape(3.dp)))
                }
            }
            Text("Today", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            if (today.isEmpty() && error == null) Text("No habits scheduled today in this community.")
        }
        items(today, key = { it.id }) { h ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(12.dp)) {
                    Text(h.name, style = MaterialTheme.typography.titleMedium)
                    Text(TimeFmt.to12h(h.preferredTime) + "  |  " + (h.status ?: "not logged"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("done" to "Done", "completed" to "Completed", "missed" to "Missed").forEach { (s, label) ->
                            OutlinedButton(onClick = { scope.launch { runCatching { api.logActivity(h.id, s) }; reload() } }) { Text(label) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TipsScreen(api: HabitApi) {
    var recs by remember { mutableStateOf<List<Recommendation>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun reload() { try { recs = api.recommendations(); error = null } catch (e: Exception) { error = e.message } }
    LaunchedEffect(Unit) { reload() }
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Recommendations", style = MaterialTheme.typography.titleLarge)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (recs.isEmpty() && error == null) Text("Nothing to suggest right now.")
        }
        items(recs, key = { it.id }) { r ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(12.dp)) {
                    Text(r.kind.replaceFirstChar { it.uppercase() } + ": " + (r.currentValue ?: "") + " to " + (r.suggestedValue ?: ""))
                    Text(r.reason, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { scope.launch { runCatching { api.acceptRecommendation(r.id) }; reload() } }) { Text("Accept") }
                        OutlinedButton(onClick = { scope.launch { runCatching { api.dismissRecommendation(r.id) }; reload() } }) { Text("Dismiss") }
                    }
                }
            }
        }
    }
}

@Composable
fun WearablesScreen(api: HabitApi, store: TokenStore) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var status by remember { mutableStateOf(if (store.pairing != null) "Paired link on file. Press the button to send it again." else "Not paired yet.") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Wearables", style = MaterialTheme.typography.titleLarge)
        Text("Pair your Galaxy Watch. Walk, run and cycle workouts and daily steps flow into your habits.")
        Button(enabled = !busy, onClick = {
            busy = true; status = "Creating link..."
            scope.launch {
                try {
                    val sent: Int = WatchPairing.pair(context, api, store)
                    status = if (sent > 0) "Sent to $sent watch(es). Open HabitLoop on the watch." else "Link created, but no watch is connected."
                } catch (e: ApiException) {
                    status = "Failed: ${e.message}"
                } catch (e: Exception) {
                    status = "Failed: ${e.message ?: e.javaClass.simpleName}"
                }
                busy = false
            }
        }, modifier = Modifier.semantics { contentDescription = "pair-watch" }) { Text("Pair Galaxy Watch") }
        Text(status, modifier = Modifier.semantics { contentDescription = "pair-status" })
    }
}
