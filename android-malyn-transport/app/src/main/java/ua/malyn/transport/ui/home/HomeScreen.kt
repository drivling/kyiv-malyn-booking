package ua.malyn.transport.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import ua.malyn.transport.domain.model.Direction
import ua.malyn.transport.domain.model.JourneyOption
import ua.malyn.transport.domain.model.PlannerTimeMode

@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    vm: HomeViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()

    Surface(modifier = modifier.fillMaxSize()) {
        when {
            state.loading -> LoadingContent()
            state.error != null -> ErrorContent(error = state.error ?: "Помилка", onRetry = vm::reload)
            else -> PlannerContent(state = state, vm = vm)
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
    ) {
        CircularProgressIndicator()
        Text(
            text = "Завантаження розкладу…",
            modifier = Modifier.padding(top = 16.dp),
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

@Composable
private fun PlannerContent(
    state: HomeUiState,
    vm: HomeViewModel,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Планувальник поїздки",
            style = MaterialTheme.typography.titleMedium,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StopSelector(
                label = "Звідки",
                allStops = state.allStops,
                selected = state.fromStop,
                onSelected = vm::onFromStopSelected,
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = vm::onSwapStops,
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Icon(Icons.Filled.SwapVert, contentDescription = "Поміняти місцями")
            }
            StopSelector(
                label = "Куди",
                allStops = state.allStops,
                selected = state.toStop,
                onSelected = vm::onToStopSelected,
                modifier = Modifier.weight(1f),
            )
        }

        TimeSelector(
            timeMinutes = state.timeMinutes,
            mode = state.timeMode,
            onModeChange = vm::onTimeModeChanged,
            onShiftTime = vm::shiftTimeBy,
        )

        JourneysList(journeys = state.journeys)
    }
}

@Composable
private fun StopSelector(
    label: String,
    allStops: List<String>,
    selected: String,
    onSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            label = { Text(label) },
            readOnly = true,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true },
        )
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            allStops.forEach { stop ->
                DropdownMenuItem(
                    text = { Text(stop) },
                    onClick = {
                        expanded = false
                        onSelected(stop)
                    },
                )
            }
        }
    }
}

@Composable
private fun TimeSelector(
    timeMinutes: Int,
    mode: PlannerTimeMode,
    onModeChange: (PlannerTimeMode) -> Unit,
    onShiftTime: (Int) -> Unit,
) {
    val hours = (timeMinutes / 60) % 24
    val mins = timeMinutes % 60
    val timeLabel = String.format("%02d:%02d", hours, mins)

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = mode == PlannerTimeMode.DEPART_AT,
                onClick = { onModeChange(PlannerTimeMode.DEPART_AT) },
                label = { Text("Вирушити о") },
                leadingIcon = if (mode == PlannerTimeMode.DEPART_AT) {
                    { Icon(Icons.Filled.Schedule, contentDescription = null) }
                } else null,
            )
            FilterChip(
                selected = mode == PlannerTimeMode.ARRIVE_BY,
                onClick = { onModeChange(PlannerTimeMode.ARRIVE_BY) },
                label = { Text("Прибути до") },
                leadingIcon = if (mode == PlannerTimeMode.ARRIVE_BY) {
                    { Icon(Icons.Filled.Schedule, contentDescription = null) }
                } else null,
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = timeLabel,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(top = 4.dp),
            )
            TextButton(onClick = { onShiftTime(-15) }) {
                Text("−15 хв")
            }
            TextButton(onClick = { onShiftTime(15) }) {
                Text("+15 хв")
            }
        }
    }
}

@Composable
private fun JourneysList(
    journeys: List<JourneyOption>,
) {
    if (journeys.isEmpty()) {
        Text(
            text = "Немає знайдених поїздок для вибраних зупинок і часу.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 8.dp),
        contentPadding = PaddingValues(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(journeys) { journey ->
            JourneyCard(journey)
        }
    }
}

@Composable
private fun JourneyCard(journey: JourneyOption) {
    val depH = (journey.departureMinutes / 60) % 24
    val depM = journey.departureMinutes % 60
    val arrH = (journey.arrivalMinutes / 60) % 24
    val arrM = journey.arrivalMinutes % 60
    val depStr = String.format("%02d:%02d", depH, depM)
    val arrStr = String.format("%02d:%02d", arrH, arrM)
    val duration = journey.arrivalMinutes - journey.departureMinutes
    val durH = duration / 60
    val durM = duration % 60
    val durStr = if (durH > 0) "${durH} год ${durM} хв" else "${durM} хв"

    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = buildString {
                    append("Маршрут №${journey.routeId}")
                    if (!journey.routeFrom.isNullOrBlank() || !journey.routeTo.isNullOrBlank()) {
                        append(" · ")
                        append(journey.routeFrom ?: "")
                        append(" — ")
                        append(journey.routeTo ?: "")
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                text = "${journey.fromStop} → ${journey.toStop}",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                text = "$depStr → $arrStr ($durStr)",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = when (journey.direction) {
                    Direction.THERE -> "Напрямок: туди"
                    Direction.BACK -> "Напрямок: назад"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

