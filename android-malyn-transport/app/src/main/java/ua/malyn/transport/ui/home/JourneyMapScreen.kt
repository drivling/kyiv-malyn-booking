package ua.malyn.transport.ui.home

import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DirectionsBus
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ua.malyn.transport.domain.model.JourneyOption
import ua.malyn.transport.domain.model.PlannerTimeMode
import ua.malyn.transport.domain.model.Stop
import ua.malyn.transport.ui.map.OsmMapView

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

    var nowMinutes by remember { mutableIntStateOf(currentTimeMinutes()) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(30_000)
            nowMinutes = currentTimeMinutes()
        }
    }

    val depH = (journey.departureMinutes / 60) % 24
    val depM = journey.departureMinutes % 60
    val arrH = (journey.arrivalMinutes / 60) % 24
    val arrM = journey.arrivalMinutes % 60
    val depStr = String.format("%02d:%02d", depH, depM)
    val arrStr = String.format("%02d:%02d", arrH, arrM)
    val duration = journey.arrivalMinutes - journey.departureMinutes
    val minutesUntilDeparture = (journey.departureMinutes - nowMinutes + 24 * 60) % (24 * 60)

    Column(modifier = Modifier.fillMaxSize()) {
        // 1. Заголовок — темний блок від самого верху (edge-to-edge)
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
                        Column {
                            Text(
                                text = "Відправлення через",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.8f),
                            )
                            Row(verticalAlignment = Alignment.Bottom) {
                                Text(
                                    text = "$minutesUntilDeparture",
                                    style = MaterialTheme.typography.displaySmall,
                                    color = Color.White,
                                    fontSize = 32.sp,
                                )
                                Text(
                                    text = " хв",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = Color.White.copy(alpha = 0.9f),
                                    modifier = Modifier.padding(bottom = 4.dp),
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(16.dp))
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = Color(0xFF4CAF50),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.DirectionsBus,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(20.dp),
                                )
                                Text(
                                    text = "№${journey.routeId}",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Color.White,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "$duration хв",
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White,
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Color(0xFF4CAF50).copy(alpha = 0.3f),
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
                            color = Color(0xFF2196F3).copy(alpha = 0.3f),
                        ) {
                            Text(
                                text = arrStr,
                                style = MaterialTheme.typography.labelLarge,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
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
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RectangleShape),
        ) {
            OsmMapView(
                modifier = Modifier.fillMaxSize(),
                stops = mapStops,
            )

            // 3. Правий блок — таймлайн маршруту
            JourneyTimelinePanel(
                journey = journey,
                mapStops = mapStops,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .width(200.dp)
                    .padding(12.dp),
            )
        }
    }
}

@Composable
private fun JourneyTimelinePanel(
    journey: JourneyOption,
    mapStops: List<Stop>,
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
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
                    .background(Color(0xFF4CAF50)),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.DirectionsBus,
                    contentDescription = null,
                    tint = Color(0xFF4CAF50),
                    modifier = Modifier.size(24.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "№${journey.routeId}",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFF4CAF50),
                )
            }
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height(8.dp)
                    .align(Alignment.CenterHorizontally)
                    .background(Color(0xFF4CAF50)),
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
                    .background(Color(0xFF2196F3)),
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

@Composable
private fun TimelineItem(
    time: String,
    label: String,
    isStart: Boolean,
    isLast: Boolean,
) {
    val color = when {
        isStart -> Color(0xFF4CAF50)
        isLast -> Color(0xFF2196F3)
        else -> Color(0xFF757575)
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(vertical = 4.dp),
        ) {
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
        Column(modifier = Modifier.weight(1f)) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = color.copy(alpha = 0.15f),
            ) {
                Text(
                    text = time,
                    style = MaterialTheme.typography.labelLarge,
                    color = color,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
