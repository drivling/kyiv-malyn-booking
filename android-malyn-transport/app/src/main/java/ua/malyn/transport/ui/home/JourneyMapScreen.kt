package ua.malyn.transport.ui.home

import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ua.malyn.transport.domain.model.JourneyOption
import ua.malyn.transport.domain.model.PlannerTimeMode
import ua.malyn.transport.domain.model.Stop
import ua.malyn.transport.ui.map.OsmMapView

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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        JourneySummaryCard(
            journey = journey,
            selectedTimeMinutes = selectedTimeMinutes,
            mode = mode,
            modifier = Modifier.fillMaxWidth(),
            onClick = null,
        )

        // Карта маршруту (OpenStreetMap) — зупинки та полілінія
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .defaultMinSize(minHeight = 200.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        ) {
            OsmMapView(
                modifier = Modifier.fillMaxSize(),
                stops = mapStops,
            )
        }
    }
}
