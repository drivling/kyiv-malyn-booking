package ua.malyn.transport.ui.schedule

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DirectionsBus
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.statusBars
import androidx.core.view.WindowCompat
import ua.malyn.transport.domain.model.Direction
import ua.malyn.transport.domain.model.Stop
import ua.malyn.transport.ui.map.OsmMapView

@Composable
fun ScheduleRouteMapScreen(
    routeId: String,
    routeFrom: String?,
    routeTo: String?,
    mapStops: List<Stop>,
    direction: Direction,
    onClose: () -> Unit,
    onToggleDirection: () -> Unit,
) {
    BackHandler(onBack = onClose)

    val view = LocalView.current
    val window = (view.context as? Activity)?.window
    androidx.compose.runtime.DisposableEffect(window) {
        if (window != null) {
            val controller = WindowCompat.getInsetsController(window, view)
            val wasLight = controller.isAppearanceLightStatusBars
            controller.isAppearanceLightStatusBars = false
            onDispose { controller.isAppearanceLightStatusBars = wasLight }
        } else {
            onDispose { }
        }
    }

    val destination = if (direction == Direction.THERE) (routeTo ?: mapStops.lastOrNull()?.name ?: "") else (routeFrom ?: mapStops.lastOrNull()?.name ?: "")

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color(0xFF2D2D2D),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top))
                    .padding(horizontal = 8.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад", tint = Color.White)
                }
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color(0xFF4CAF50),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(Icons.Filled.DirectionsBus, null, tint = Color.White, modifier = Modifier.size(20.dp))
                            Text("№$routeId", style = MaterialTheme.typography.titleMedium, color = Color.White)
                        }
                    }
                    Text("→", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = destination.uppercase(),
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White,
                        maxLines = 1,
                    )
                }
                IconButton(onClick = onToggleDirection) {
                    Icon(Icons.Filled.SwapVert, "Змінити напрямок", tint = Color.White)
                }
            }
        }

        var isPanelExpanded by remember { mutableStateOf(true) }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RectangleShape),
        ) {
            OsmMapView(
                modifier = Modifier.fillMaxSize(),
                stops = mapStops,
                onMapTap = { isPanelExpanded = !isPanelExpanded },
            )
            Row(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AnimatedVisibility(
                    visible = isPanelExpanded,
                    enter = expandHorizontally(),
                    exit = shrinkHorizontally(),
                ) {
                    ScheduleRouteStopsPanel(
                        routeId = routeId,
                        mapStops = mapStops,
                        onToggle = { isPanelExpanded = false },
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(200.dp)
                            .padding(12.dp),
                    )
                }
                if (!isPanelExpanded) {
                    Box(
                        modifier = Modifier.fillMaxHeight().padding(12.dp),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        Surface(
                            shape = RoundedCornerShape(50),
                            color = Color.White,
                            shadowElevation = 4.dp,
                        ) {
                            IconButton(
                                onClick = { isPanelExpanded = true },
                                modifier = Modifier.size(36.dp),
                            ) {
                                Icon(
                                    Icons.Filled.ChevronLeft,
                                    "Розгорнути",
                                    tint = Color(0xFF4CAF50),
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScheduleRouteStopsPanel(
    routeId: String,
    mapStops: List<Stop>,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 8.dp,
    ) {
        Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.fillMaxHeight().width(28.dp),
                contentAlignment = Alignment.Center,
            ) {
                IconButton(onClick = onToggle, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Filled.ChevronRight, "Згорнути", tint = Color(0xFF4CAF50), modifier = Modifier.size(16.dp))
                }
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.DirectionsBus, null, tint = Color(0xFF4CAF50), modifier = Modifier.size(24.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("№$routeId", style = MaterialTheme.typography.labelMedium, color = Color(0xFF4CAF50))
                }
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(8.dp)
                        .align(Alignment.CenterHorizontally)
                        .background(Color(0xFF4CAF50)),
                )
                mapStops.forEachIndexed { index, stop ->
                    val isFirst = index == 0
                    val isLast = index == mapStops.lastIndex
                    val color = when {
                        isFirst -> Color(0xFF4CAF50)
                        isLast -> Color(0xFF2196F3)
                        else -> Color(0xFF757575)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .clip(CircleShape)
                                    .background(color),
                            )
                            if (!isLast) {
                                Box(
                                    modifier = Modifier
                                        .width(2.dp)
                                        .height(20.dp)
                                        .background(color.copy(alpha = 0.4f)),
                                )
                            }
                        }
                        Text(
                            text = stop.name.uppercase(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}
