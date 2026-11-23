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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.dhruvgoel.habitloop.shared.Recommendation
import com.dhruvgoel.habitloop.shared.Summary
import com.dhruvgoel.habitloop.shared.TimeFmt
import com.dhruvgoel.habitloop.shared.TodayItem
import com.dhruvgoel.habitloop.shared.TokenStore
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
            val api: HabitApi = remember { HabitApi(BuildConfig.API_BASE_URL, { store.token }, reauth = {
                if (store.email.isBlank() || store.password.isEmpty()) null
                else try { HabitApi(BuildConfig.API_BASE_URL, { null }).login(store.email, store.password).token.also { store.token = it } } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { null }
            }) }
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
        Text("Tenant: " + tenantFromEmail(email), Modifier.padding(top = 8.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        if (busy) androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth())
        Button(
            onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        val em: String = email.trim().lowercase()
                        onDone(if (register) api.register(em, password, name.trim()) else api.login(em, password), em, password)
                    } catch (e: ApiException) {
                        error = e.message
                    } catch (e: kotlinx.coroutines.CancellationException) { throw e
                    } catch (e: Exception) {
                        error = "Cannot reach the server"
                    }
                    busy = false
                }
            },
            enabled = !busy && android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches() && password.isNotEmpty() && (!register || name.isNotBlank()),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
        ) { Text(if (busy) "Please wait" else if (register) "Register" else "Sign in") }
        TextButton(enabled = !busy, onClick = { register = !register; error = null }) {
            Text(if (register) "I already have an account" else "Create an account")
        }
    }
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
    var busy by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        busy = true
        try { recs = api.recommendations(); error = null; loaded = true }
        catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { error = e.message ?: "Could not load recommendations" }
        finally { busy = false }
    }
    fun act(id: String, accept: Boolean) {
        busy = true; error = null
        scope.launch {
            try {
                if (accept) api.acceptRecommendation(id) else api.dismissRecommendation(id)
                reload()
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Could not update recommendation" }
            finally { busy = false }
        }
    }
    LaunchedEffect(Unit) { reload() }
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Recommendations", style = MaterialTheme.typography.titleLarge)
            if (busy) androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth())
            TextButton(enabled = !busy, onClick = { scope.launch { reload() } }) { Text("Refresh") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (loaded && recs.isEmpty() && error == null) Text("Nothing to suggest right now.")
        }
        items(recs, key = { it.id }) { r ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(12.dp)) {
                    Text(r.kind.replaceFirstChar { it.uppercase() } + ": " + scheduleValue(r.currentValue) + " to " + scheduleValue(r.suggestedValue))
                    Text(r.reason, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !busy, onClick = { act(r.id, true) }) { Text("Accept") }
                        OutlinedButton(enabled = !busy, onClick = { act(r.id, false) }) { Text("Dismiss") }
                    }
                }
            }
        }
    }
}
