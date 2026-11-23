plugins {
    id("com.android.application") version "8.7.3" apply false
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
}

val habitloopApiUrl = providers.gradleProperty("habitloopApiUrl")
    .getOrElse("https://d27ejjxk14dxyq.cloudfront.net").trimEnd('/')
val apiUri = java.net.URI(habitloopApiUrl)
require(apiUri.scheme in listOf("http", "https") && !apiUri.host.isNullOrBlank() &&
    apiUri.rawQuery == null && apiUri.rawFragment == null && apiUri.userInfo == null) {
    "habitloopApiUrl must be an HTTP(S) base URL without credentials, query or fragment"
}
extra["habitloopBaseUrl"] = habitloopApiUrl
