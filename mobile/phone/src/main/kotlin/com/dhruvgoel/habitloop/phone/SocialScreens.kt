package com.dhruvgoel.habitloop.phone

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.dhruvgoel.habitloop.shared.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private enum class Tab(val label: String) { Home("Home"), Dashboard("Dashboard"), Tips("Tips"), Wearables("Wearable") }

fun tenantFromEmail(email: String): String {
    val domain = email.substringAfter('@', "").lowercase()
    return if (domain.isBlank()) "Enter your email" else if (domain in setOf(
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
        "icloud.com", "proton.me", "protonmail.com"
    )) "Personal space (no organization)" else domain
}

fun scheduleValue(value: JsonElement?): String = when (value) {
    is JsonPrimitive -> value.content.let { if (it.matches(Regex("\\d{2}:\\d{2}"))) TimeFmt.to12h(it) else it }
    is JsonObject -> value.entries.joinToString { (key, item) -> "${key.replace('_', ' ')}: ${scheduleValue(item)}" }
    else -> ""
}

private fun Exception.displayMessage(): String {
    if (this is CancellationException) throw this
    return if (this is ApiException) message ?: "Request failed" else "Cannot reach the server. Please try again."
}

@Composable
fun MainScaffold(api: HabitApi, store: TokenStore, dark: Boolean, onDark: (Boolean) -> Unit, onLogout: () -> Unit) {
    var tab by remember { mutableStateOf(Tab.Home) }
    var account by remember { mutableStateOf(false) }
    var epoch by remember { mutableIntStateOf(0) }
    var community by remember { mutableStateOf("") }
    var communityId by remember { mutableStateOf("") }
    LaunchedEffect(epoch) { try { val me = api.me(); community = me.community.name; communityId = me.community.id } catch (e: Exception) { e.displayMessage() } }
    BackHandler(account) { account = false }
    Scaffold(topBar = {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(community.ifBlank { "HabitLoop" }, Modifier.weight(1f), maxLines = 1)
            TextButton(onClick = { onDark(!dark) }) {
                Icon(if (dark) Icons.Default.LightMode else Icons.Default.DarkMode,
                    contentDescription = if (dark) "Switch to light theme" else "Switch to dark theme")
                Text(if (dark) "Light" else "Dark", Modifier.padding(start = 4.dp))
            }
            IconButton(onClick = { account = !account }) { Icon(Icons.Default.AccountCircle, contentDescription = "Account") }
        }
    }, bottomBar = {
        NavigationBar {
            Tab.entries.forEach { t ->
                NavigationBarItem(selected = !account && tab == t, onClick = { account = false; tab = t },
                    icon = {}, label = { Text(t.label) })
            }
        }
    }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            key(epoch) {
                if (account) AccountScreen(api, onSwitch = { store.token = it.token; epoch++ }, onLogout = onLogout)
                else when (tab) {
                    Tab.Home -> HomeScreen(api) { id ->
                        if (id != communityId) {
                            val switched = api.switchCommunity(id)
                            store.token = switched.token
                            community = switched.community.name; communityId = switched.community.id
                        }
                    }
                    Tab.Dashboard -> DashboardScreen(api)
                    Tab.Tips -> TipsScreen(api)
                    Tab.Wearables -> WearablesScreen(api, store)
                }
            }
        }
    }
}

@Composable
private fun AccountScreen(api: HabitApi, onSwitch: (AuthResponse) -> Unit, onLogout: () -> Unit) {
    var me by remember { mutableStateOf<Account?>(null) }
    var communities by remember { mutableStateOf<List<MyCommunity>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(true) }
    var refresh by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(refresh) {
        busy = true
        try { me = api.me(); communities = api.communities(); error = null }
        catch (e: Exception) { error = e.displayMessage() }
        finally { busy = false }
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Account", style = MaterialTheme.typography.titleLarge)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { refresh++ }, enabled = !busy) { Text("Retry") } }
            me?.let {
                Text(it.name, style = MaterialTheme.typography.titleMedium)
                Text(it.email)
                Text("Tenant: ${it.organization?.domain ?: "No organization"}")
            }
            Text("Communities", Modifier.padding(top = 16.dp), style = MaterialTheme.typography.titleMedium)
        }
        items(communities, key = { it.id }) { c ->
            OutlinedButton(enabled = !busy && c.id != me?.community?.id, onClick = {
                busy = true; error = null
                scope.launch {
                    try { onSwitch(api.switchCommunity(c.id)) }
                    catch (e: Exception) { error = e.displayMessage() }
                    finally { busy = false }
                }
            }, modifier = Modifier.fillMaxWidth()) { Text(c.name + if (c.id == me?.community?.id) " (current)" else " | Switch") }
        }
        item { Button(onClick = onLogout, enabled = !busy) { Text("Log out") } }
    }
}

@Composable
fun HomeScreen(api: HabitApi, onCommunity: suspend (String) -> Unit) {
    var posts by remember { mutableStateOf<List<WallPost>>(emptyList()) }
    var selected by remember { mutableStateOf<WallPost?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var cursor by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load(more: Boolean = false) {
        if (busy) return
        busy = true
        try {
            val page = api.wall(if (more) cursor else null)
            posts = (if (more) posts + page.posts else page.posts).distinctBy { it.id }
            cursor = page.nextCursor; error = null
        } catch (e: Exception) { error = e.displayMessage() }
        finally { busy = false }
    }
    LaunchedEffect(Unit) { load() }
    BackHandler(selected != null) { selected = null }
    if (selected != null) {
        ChallengeScreen(api, selected!!, onBack = { selected = null; scope.launch { load() } })
        return
    }
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("All my communities", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                TextButton(enabled = !busy, onClick = { scope.launch { load() } }) { Text("Refresh") }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (!busy && posts.isEmpty() && error == null) Text("No posts yet.")
        }
        items(posts, key = { it.id }) { post ->
            PostCard(api, post, onOpen = {
                if (!busy) {
                    busy = true
                    scope.launch {
                        try { onCommunity(post.community.id); selected = post; error = null }
                        catch (e: Exception) { error = e.displayMessage() }
                        finally { busy = false }
                    }
                }
            }, onChanged = { scope.launch { load() } })
        }
        if (cursor != null) item { TextButton(enabled = !busy, onClick = { scope.launch { load(true) } }) { Text("Load more") } }
    }
}

@Composable
private fun PostCard(api: HabitApi, post: WallPost, onOpen: () -> Unit, onChanged: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Card {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Column(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
                Text(post.challenge.title, style = MaterialTheme.typography.titleMedium)
                Text("by ${post.authorName} in ${post.community.name}", style = MaterialTheme.typography.bodySmall)
                post.imageUrl?.let { RemoteImage(it, Modifier.fillMaxWidth().height(160.dp)) }
                if (post.caption.isNotBlank()) Text(post.caption)
            }
            post.caringValue?.let { SuggestionChip(onClick = onOpen, label = { Text(it) }) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        try { api.like(post.id); error = null; onChanged() }
                        catch (e: Exception) { error = e.displayMessage() }
                        finally { busy = false }
                    }
                }) { Text("${if (post.likedByMe) "Unlike" else "Like"} ${post.likeCount}") }
                TextButton(onClick = onOpen) { Text("Challenge details") }
            }
            if (post.ownedByMe) Text("Your challenge", color = MaterialTheme.colorScheme.primary)
            else if (post.joinedByMe) Text("Joined", color = MaterialTheme.colorScheme.primary)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Comments(api, post, onChanged = onChanged)
        }
    }
}

@Composable
private fun Comments(api: HabitApi, post: WallPost, all: Boolean = false, onChanged: () -> Unit = {}) {
    var expanded by rememberSaveable(post.id) { mutableStateOf(all) }
    var comments by remember(post.id) { mutableStateOf(post.latestComments.reversed()) }
    var text by rememberSaveable(post.id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(post.latestComments, expanded, refresh) {
        if (expanded) {
            busy = true
            try { comments = api.comments(post.id); error = null }
            catch (e: Exception) { error = e.displayMessage() }
            finally { busy = false }
        } else comments = post.latestComments.reversed()
    }
    (if (expanded) comments else comments.takeLast(2)).forEach {
        Text("${it.authorName}: ${it.body}", style = MaterialTheme.typography.bodyMedium)
    }
    if (!all && post.commentCount > 0) TextButton(onClick = { expanded = !expanded }, enabled = !busy) {
        Text(if (expanded) "Show latest 2" else "View all ${post.commentCount} comments")
    }
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { expanded = true; refresh++ }) { Text("Retry comments") } }
    OutlinedTextField(text, { if (it.length <= 2000) text = it }, enabled = !busy,
        label = { Text("Add a comment") }, modifier = Modifier.fillMaxWidth(), maxLines = 4)
    TextButton(enabled = !busy && text.isNotBlank(), onClick = {
        busy = true; error = null
        scope.launch {
            try {
                api.comment(post.id, text.trim()); text = ""
                try { comments = api.comments(post.id) } catch (e: Exception) { error = e.displayMessage() }
                onChanged()
            } catch (e: Exception) { error = e.displayMessage() }
            finally { busy = false }
        }
    }) { Text("Post comment") }
}

@Composable
private fun ChallengeScreen(api: HabitApi, post: WallPost, onBack: () -> Unit) {
    var challenge by remember { mutableStateOf(post.challenge) }
    var progress by remember { mutableStateOf<ChallengeProgress?>(null) }
    var joined by remember { mutableStateOf(post.joinedByMe) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(true) }
    var refresh by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(refresh) {
        busy = true; error = null
        try { challenge = api.challenge(post.challengeId) }
        catch (e: Exception) { error = e.displayMessage() }
        try { progress = api.progress(post.challengeId) }
        catch (e: Exception) { error = "Leaderboard: ${e.displayMessage()}" }
        finally { busy = false }
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            TextButton(onClick = onBack) { Text("Back to wall") }
            Text(challenge.title, style = MaterialTheme.typography.headlineSmall)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { refresh++ }, enabled = !busy) { Text("Retry") } }
            Text(challenge.description.ifBlank { post.caption.ifBlank { "No description provided." } })
            Text("${challenge.startDate} to ${challenge.endDate}")
            post.caringValue?.let { SuggestionChip(onClick = {}, label = { Text(it) }) }
            Text("Visibility: ${challenge.visibility}")
            Text("Participants: ${post.participantCount + if (joined && !post.joinedByMe) 1 else 0}")
            Text("Target: ${challenge.targetCount}")
            when {
                post.ownedByMe -> Text("Your challenge", color = MaterialTheme.colorScheme.primary)
                joined -> Text("Joined", color = MaterialTheme.colorScheme.primary)
                else -> Button(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        try { api.joinChallenge(post.challengeId); joined = true; error = null }
                        catch (e: Exception) { error = e.displayMessage() }
                        finally { busy = false }
                    }
                }) { Text("Join") }
            }
            Text("Leaderboard", style = MaterialTheme.typography.titleMedium)
            if (progress?.leaderboard?.isEmpty() == true) Text("No progress recorded yet.")
        }
        items(progress?.leaderboard ?: emptyList()) { Text("${it.rank}. ${it.name}: ${it.count} / ${it.target}") }
        item { Text("All comments", style = MaterialTheme.typography.titleMedium); Comments(api, post, all = true) }
    }
}
