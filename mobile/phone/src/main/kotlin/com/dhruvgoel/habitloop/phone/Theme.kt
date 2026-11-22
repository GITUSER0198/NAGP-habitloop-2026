package com.dhruvgoel.habitloop.phone

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Midnight tokens from frontend/theme/tokens.css (light default, dark toggle).
private val LightScheme = lightColorScheme(
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF042C53),
    surface = Color(0xFFE6F1FB),
    onSurface = Color(0xFF042C53),
    surfaceVariant = Color(0xFFFFFFFF),
    onSurfaceVariant = Color(0xFF5F5E5A),
    primary = Color(0xFF0F6E56),
    onPrimary = Color(0xFFFFFFFF),
    error = Color(0xFFA32D2D)
)

private val DarkScheme = darkColorScheme(
    background = Color(0xFF0B0B0B),
    onBackground = Color(0xFFF1EFE8),
    surface = Color(0xFF042C53),
    onSurface = Color(0xFFF1EFE8),
    surfaceVariant = Color(0xFF0C447C),
    onSurfaceVariant = Color(0xFFB4B2A9),
    primary = Color(0xFF5DCAA5),
    onPrimary = Color(0xFF04342C),
    error = Color(0xFFF09595)
)

@Composable
fun HabitLoopTheme(dark: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, content = content)
}
