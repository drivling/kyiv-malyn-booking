package ua.malyn.transport.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    vm: HomeViewModel,
) {
    val state by vm.state.collectAsState()
    val selectedJourney = state.selectedJourney

    Surface(modifier = modifier.fillMaxSize()) {
        when {
            state.loading -> LoadingContent()
            state.error != null -> ErrorContent(error = state.error ?: "Помилка", onRetry = vm::reload)
            selectedJourney != null -> JourneyMapScreen(
                journey = selectedJourney,
                mapStops = state.mapStops,
                selectedTimeMinutes = state.timeMinutes,
                mode = state.timeMode,
                onClose = vm::onJourneyClosed,
            )
            else -> PlannerScreen(
                state = state,
                isSearchExpanded = state.isPlannerExpanded,
                onSearchExpandedChange = vm::setPlannerExpanded,
                onFromSelected = vm::onFromStopSelected,
                onToSelected = vm::onToStopSelected,
                onSwapStops = vm::onSwapStops,
                onTimeModeChange = vm::onTimeModeChanged,
                onShiftTime = vm::shiftTimeBy,
                onJourneyClick = vm::onJourneySelected,
            )
        }
    }
}

@Composable
private fun LoadingContent() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(modifier = Modifier.size(56.dp))
        Text(
            text = "Завантаження розкладу…",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 24.dp),
        )
    }
}

@Composable
private fun ErrorContent(
    error: String,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = error,
            color = MaterialTheme.colorScheme.error,
        )
        Button(
            onClick = onRetry,
        ) {
            Text("Повторити")
        }
    }
}

/**
 * Планувальник у стилі Jakdojade: вертикальний блок «Звідки»/«Куди», іконки,
 * плейсхолдери, компактний час, список рейсів знизу.
 */
