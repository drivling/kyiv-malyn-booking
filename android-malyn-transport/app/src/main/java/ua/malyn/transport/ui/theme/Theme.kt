package ua.malyn.transport.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Кольори в стилі застосунку Jakdojade: зелений акцент для пошуку та кнопок
private val GreenPrimary = Color(0xFF2E7D32)
private val GreenPrimaryDark = Color(0xFF1B5E20)
private val GreenOnPrimary = Color.White
private val GreenSurfaceLight = Color(0xFFE8F5E9)
private val GreenSurfaceDark = Color(0xFF1B2E1F)

private val LightColors = lightColorScheme(
    primary = GreenPrimary,
    onPrimary = GreenOnPrimary,
    primaryContainer = GreenSurfaceLight,
    onPrimaryContainer = GreenPrimaryDark,
    secondary = GreenPrimaryDark,
    onSecondary = GreenOnPrimary,
    surface = Color.White,
    onSurface = Color(0xFF1C1B1F),
    surfaceVariant = Color(0xFFE7E0EC),
    onSurfaceVariant = Color(0xFF49454F),
    outline = Color(0xFF79747E),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF81C784),
    onPrimary = GreenPrimaryDark,
    primaryContainer = GreenSurfaceDark,
    onPrimaryContainer = Color(0xFFA5D6A7),
    secondary = Color(0xFF81C784),
    onSecondary = GreenPrimaryDark,
    surface = Color(0xFF1C1B1F),
    onSurface = Color(0xFFE6E1E5),
    surfaceVariant = Color(0xFF49454F),
    onSurfaceVariant = Color(0xFFCAC4D0),
    outline = Color(0xFF938F99),
)

@Composable
fun MalynTransportTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = androidx.compose.material3.Typography(),
        content = content,
    )
}

