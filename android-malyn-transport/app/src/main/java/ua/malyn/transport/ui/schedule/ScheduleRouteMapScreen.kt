package ua.malyn.transport.ui.schedule

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import ua.malyn.transport.ui.schedule.SchedulePanelHeaderColor
import ua.malyn.transport.ui.schedule.ScheduleRouteLineColor
import ua.malyn.transport.ui.schedule.ScheduleTabActiveColor

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

    val destination = if (direction == Direction.THERE) {
        (routeTo ?: mapStops.lastOrNull()?.name ?: "")
    } else {
        (routeFrom ?: mapStops.lastOrNull()?.name ?: "")
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .weight(2f)
                .fillMaxWidth(),
        ) {
            OsmMapView(
                modifier = Modifier.fillMaxSize(),
                stops = mapStops,
            )
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopStart)
                    .windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top)),
                color = SchedulePanelHeaderColor.copy(alpha = 0.96f),
                shadowElevation = 4.dp,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    IconButton(onClick = onClose) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Назад",
                            tint = Color.White,
                        )
                    }
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color.White,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(
                                Icons.Filled.DirectionsBus,
                                contentDescription = null,
                                tint = SchedulePanelHeaderColor,
                                modifier = Modifier.size(20.dp),
                            )
                            Text(
                                text = routeId,
                                style = MaterialTheme.typography.titleMedium,
                                color = SchedulePanelHeaderColor,
                            )
                        }
                    }
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            text = destination.uppercase(),
                            style = MaterialTheme.typography.titleSmall,
                            color = Color.White,
                            maxLines = 1,
                        )
                        Text(
                            text = "Малин транспорт",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.8f),
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        Surface(
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
            color = Color.White,
            shadowElevation = 8.dp,
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                ScheduleRoutePanelHeader(
                    routeId = routeId,
                    destination = destination,
                    onToggleDirection = onToggleDirection,
                )
                ScheduleRouteStopsList(
                    mapStops = mapStops,
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp, vertical = 16.dp),
                )
            }
        }
    }
}

@Composable
private fun ScheduleRoutePanelHeader(
    routeId: String,
    destination: String,
    onToggleDirection: () -> Unit,
) {
    var activeTab by remember { mutableStateOf(0) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(SchedulePanelHeaderColor)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Filled.DirectionsBus,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp),
                )
                Text(
                    text = routeId,
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                )
            }
            Text(
                text = "Малин транспорт",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.9f),
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "→ ${destination.uppercase()}",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                maxLines = 1,
            )
            Surface(
                shape = CircleShape,
                color = Color.White,
            ) {
                IconButton(onClick = onToggleDirection) {
                    Icon(
                        Icons.Filled.SwapVert,
                        contentDescription = "Змінити напрямок",
                        tint = SchedulePanelHeaderColor,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            listOf("Головний маршрут", "Всі варіанти").forEachIndexed { index, label ->
                val isActive = activeTab == index
                Column(
                    modifier = Modifier
                        .clickable { activeTab = index }
                        .padding(horizontal = 4.dp),
                    horizontalAlignment = Alignment.Start,
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (isActive) ScheduleTabActiveColor else Color.White.copy(alpha = 0.8f),
                    )
                    if (isActive) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Box(
                            modifier = Modifier
                                .height(2.dp)
                                .width(120.dp)
                                .background(ScheduleTabActiveColor),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ScheduleRouteStopsList(
    mapStops: List<Stop>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.width(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            mapStops.forEachIndexed { index, _ ->
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .border(2.dp, ScheduleRouteLineColor, CircleShape),
                )
                if (index < mapStops.lastIndex) {
                    Box(
                        modifier = Modifier
                            .width(2.dp)
                            .height(24.dp)
                            .background(ScheduleRouteLineColor),
                    )
                }
            }
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            mapStops.forEachIndexed { index, stop ->
                Text(
                    text = stop.name.uppercase(),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
                if (index < mapStops.lastIndex) {
                    Spacer(modifier = Modifier.height(18.dp))
                }
            }
        }
    }
}
