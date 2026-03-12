package ua.malyn.transport.ui.home

import android.util.Log
import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.DisposableEffect
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DirectionsBus
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.core.MutableTransitionState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import ua.malyn.transport.domain.model.JourneyOption
import ua.malyn.transport.domain.model.PlannerTimeMode
import ua.malyn.transport.domain.model.Stop
import ua.malyn.transport.ui.map.OsmMapView
import ua.malyn.transport.ui.schedule.SchedulePanelHeaderColor
import ua.malyn.transport.ui.schedule.ScheduleRouteLineColor
import ua.malyn.transport.ui.schedule.ScheduleTabActiveColor

private fun currentTimeMinutes(): Int {
    val now = java.time.LocalTime.now()
    return now.hour * 60 + now.minute
}

@Composable
fun JourneyMapScreen(
    journey: JourneyOption,
    mapStops: List<Stop>,
    selectedTimeMinutes: Int,
    mode: PlannerTimeMode,
    onClose: () -> Unit,
) {
    Log.d("JourneyMap", "JourneyMapScreen: journey=${journey.routeId} ${journey.fromStop}→${journey.toStop}, mapStops=${mapStops.size}")
    BackHandler(onBack = onClose)

    val view = LocalView.current
    val window = (view.context as? Activity)?.window
    DisposableEffect(window) {
        if (window != null) {
            val controller = WindowCompat.getInsetsController(window, view)
            val wasLight = controller.isAppearanceLightStatusBars
            controller.isAppearanceLightStatusBars = false
            onDispose {
                controller.isAppearanceLightStatusBars = wasLight
            }
        } else {
            onDispose { }
        }
    }

    val depH = (journey.departureMinutes / 60) % 24
    val depM = journey.departureMinutes % 60
    val arrH = (journey.arrivalMinutes / 60) % 24
    val arrM = journey.arrivalMinutes % 60
    val depStr = String.format("%02d:%02d", depH, depM)
    val arrStr = String.format("%02d:%02d", arrH, arrM)
    val duration = journey.arrivalMinutes - journey.departureMinutes
    val durH = duration / 60
    val durM = duration % 60
    val durationStr = if (durH > 0) "${durH} h ${durM} min" else "${durM} min"
    val deltaMinutesRaw = when (mode) {
        PlannerTimeMode.DEPART_AT -> journey.departureMinutes - selectedTimeMinutes
        PlannerTimeMode.ARRIVE_BY -> selectedTimeMinutes - journey.arrivalMinutes
    }
    val deltaMinutes = deltaMinutesRaw.coerceAtLeast(0)
    val waitH = deltaMinutes / 60
    val waitM = deltaMinutes % 60
    val departureInStr = if (waitH > 0) "${waitH} год ${waitM} хв" else "${waitM} хв"

    Column(modifier = Modifier.fillMaxSize()) {
        // 1. Заголовок — темний блок від самого верху (edge-to-edge)
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = SchedulePanelHeaderColor,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top))
                    .padding(horizontal = 8.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Назад",
                        tint = Color.White,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(modifier = Modifier.widthIn(max = 140.dp)) {
                            Text(
                                text = "Відправлення через",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.8f),
                            )
                            Text(
                                text = departureInStr,
                                style = MaterialTheme.typography.displaySmall,
                                color = Color.White,
                                fontSize = 28.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Spacer(modifier = Modifier.width(16.dp))
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
                                    imageVector = Icons.Filled.DirectionsBus,
                                    contentDescription = null,
                                    tint = SchedulePanelHeaderColor,
                                    modifier = Modifier.size(20.dp),
                                )
                                Text(
                                    text = "№${journey.routeId}",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = SchedulePanelHeaderColor,
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Color.White.copy(alpha = 0.18f),
                        ) {
                            Text(
                                text = depStr,
                                style = MaterialTheme.typography.labelLarge,
                                    color = Color.White,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                        Text(
                            text = "→",
                            color = Color.White.copy(alpha = 0.7f),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Color.White.copy(alpha = 0.18f),
                        ) {
                            Text(
                                text = arrStr,
                                style = MaterialTheme.typography.labelLarge,
                                    color = Color.White,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Color.White.copy(alpha = 0.15f),
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(horizontal = 6.dp, vertical = 4.dp)
                                    .defaultMinSize(minWidth = 48.dp, minHeight = 28.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "⏲️ $durationStr",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Color.White,
                                )
                            }
                        }
                    }
                }
                IconButton(onClick = { /* TODO: menu */ }) {
                    Icon(
                        imageVector = Icons.Filled.MoreVert,
                        contentDescription = "Меню",
                        tint = Color.White,
                    )
                }
            }
        }

        // 2. Карта + правий блок таймлайну (clip щоб карта не перекривала заголовок)
        val panelState = remember { MutableTransitionState(true) }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RectangleShape),
        ) {
            OsmMapView(
                modifier = Modifier.fillMaxSize(),
                stops = mapStops,
                onMapTap = {
                    panelState.targetState = !panelState.targetState
                },
            )

            // 3. Правий блок — таймлайн маршруту (згортається/розгортається)
            Row(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AnimatedVisibility(
                    visibleState = panelState,
                    enter = expandHorizontally(),
                    exit = shrinkHorizontally(),
                ) {
                    JourneyTimelinePanel(
                        journey = journey,
                        mapStops = mapStops,
                        onToggle = { panelState.targetState = false },
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(260.dp)
                            .padding(12.dp),
                    )
                }
                val showCollapsedToggle = !panelState.currentState && !panelState.targetState
                if (showCollapsedToggle) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .padding(12.dp),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        Surface(
                            shape = RoundedCornerShape(50),
                            color = Color.White,
                            shadowElevation = 4.dp,
                        ) {
                            IconButton(
                                onClick = { panelState.targetState = true },
                                modifier = Modifier.size(36.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.ChevronLeft,
                                    contentDescription = "Розгорнути",
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
private fun JourneyTimelinePanel(
    journey: JourneyOption,
    mapStops: List<Stop>,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val depH = (journey.departureMinutes / 60) % 24
    val depM = journey.departureMinutes % 60
    val arrH = (journey.arrivalMinutes / 60) % 24
    val arrM = journey.arrivalMinutes % 60
    val depStr = String.format("%02d:%02d", depH, depM)
    val arrStr = String.format("%02d:%02d", arrH, arrM)

    val minsPerStop = if (mapStops.size > 1) {
        (journey.arrivalMinutes - journey.departureMinutes) / (mapStops.size - 1)
    } else 0

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(28.dp),
                contentAlignment = Alignment.Center,
            ) {
                IconButton(
                    onClick = onToggle,
                    modifier = Modifier.size(28.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.ChevronRight,
                        contentDescription = "Згорнути",
                        tint = Color(0xFF4CAF50),
                        modifier = Modifier.size(16.dp),
                    )
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
            // Старт
            TimelineItem(
                time = depStr,
                label = journey.fromStop,
                isStart = true,
                isLast = false,
            )
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height(8.dp)
                    .align(Alignment.CenterHorizontally)
                    .background(SchedulePanelHeaderColor),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.DirectionsBus,
                    contentDescription = null,
                    tint = SchedulePanelHeaderColor,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "№${journey.routeId}",
                    style = MaterialTheme.typography.labelMedium,
                    color = SchedulePanelHeaderColor,
                )
            }
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height(8.dp)
                    .align(Alignment.CenterHorizontally)
                    .background(SchedulePanelHeaderColor),
            )

            // Проміжні зупинки
            mapStops.drop(1).dropLast(1).forEachIndexed { index, stop ->
                val stopArrivalMins = journey.departureMinutes + (index + 1) * minsPerStop
                val h = (stopArrivalMins / 60) % 24
                val m = stopArrivalMins % 60
                val timeStr = String.format("%02d:%02d", h, m)
                TimelineItem(
                    time = timeStr,
                    label = stop.name,
                    isStart = false,
                    isLast = false,
                )
            }

            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height(8.dp)
                    .align(Alignment.CenterHorizontally)
                    .background(ScheduleTabActiveColor),
            )
            TimelineItem(
                time = arrStr,
                label = journey.toStop,
                isStart = false,
                isLast = true,
            )
            }
        }
    }
}

@Composable
private fun TimelineItem(
    time: String,
    label: String,
    isStart: Boolean,
    isLast: Boolean,
) {
    val color = when {
        isStart -> SchedulePanelHeaderColor
        isLast -> ScheduleTabActiveColor
        else -> ScheduleRouteLineColor
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Колонка часу — ліворуч
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = color.copy(alpha = 0.1f),
            modifier = Modifier.widthIn(min = 60.dp),
        ) {
            Text(
                text = time,
                style = MaterialTheme.typography.labelLarge,
                color = color,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }

        // Вертикальна лінія/кружок між часом і назвою зупинки
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(vertical = 4.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(Color.White),
            )
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(20.dp)
                        .background(color.copy(alpha = 0.6f)),
                )
            }
        }

        // Назва зупинки праворуч
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
