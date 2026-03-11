package ua.malyn.transport.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.DirectionsBus
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import ua.malyn.transport.R
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
@Composable
private fun PlannerContent(
    state: HomeUiState,
    vm: HomeViewModel,
) {
    val focusManager = LocalFocusManager.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        // Блок пошуку маршруту (як у Jakdojade — одна картка з полями)
        Card(
            modifier = Modifier.fillMaxWidth(),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                StopSelector(
                    label = "Звідки",
                    placeholder = "Введіть зупинку відправлення",
                    leadingIcon = Icons.Filled.Place,
                    allStops = state.allStops,
                    selected = state.fromStop,
                    onSelected = vm::onFromStopSelected,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    IconButton(onClick = vm::onSwapStops) {
                        Icon(
                            Icons.Filled.SwapVert,
                            contentDescription = "Поміняти місцями",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                StopSelector(
                    label = "Куди",
                    placeholder = "Введіть зупинку прибуття",
                    leadingIcon = Icons.Filled.Flag,
                    allStops = state.allStops,
                    selected = state.toStop,
                    onSelected = vm::onToStopSelected,
                    modifier = Modifier.fillMaxWidth(),
                )
                TimeSelector(
                    timeMinutes = state.timeMinutes,
                    mode = state.timeMode,
                    onModeChange = vm::onTimeModeChanged,
                    onShiftTime = vm::shiftTimeBy,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }

        // Кнопка пошуку як у застосунку Jakdojade — зелена кнопка внизу блоку (закриває клавіатуру)
        Button(
            onClick = { focusManager.clearFocus() },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
                .height(48.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            elevation = ButtonDefaults.buttonElevation(defaultElevation = 2.dp),
        ) {
            Icon(
                Icons.Filled.DirectionsBus,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Знайти маршрути", style = MaterialTheme.typography.titleMedium)
        }

        Text(
            text = "Рейси",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
        )

        JourneysList(journeys = state.journeys)
    }
}

/**
 * Поле вводу зупинки як у Jakdojade: текстове поле з іконкою та плейсхолдером,
 * клавіатура відкривається; під полем — список підказок по введеному тексту.
 */
@Composable
private fun StopSelector(
    label: String,
    placeholder: String,
    leadingIcon: ImageVector,
    allStops: List<String>,
    selected: String,
    onSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember(selected) { mutableStateOf(selected) }
    var showSuggestions by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    val suggestions = remember(query, allStops) {
        if (query.isBlank()) {
            allStops.take(80)
        } else {
            allStops.filter { it.contains(query, ignoreCase = true) }.take(80)
        }
    }

    Column(modifier = modifier) {
        OutlinedTextField(
            value = query,
            onValueChange = { newValue ->
                query = newValue
                showSuggestions = true
            },
            label = { Text(label) },
            placeholder = { Text(placeholder, style = MaterialTheme.typography.bodyLarge) },
            leadingIcon = { Icon(leadingIcon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { showSuggestions = it.hasFocus || query.isNotEmpty() },
        )

        AnimatedVisibility(
            visible = showSuggestions && suggestions.isNotEmpty(),
            enter = expandVertically(),
            exit = shrinkVertically(),
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 220.dp)
                    .padding(top = 4.dp),
                shape = RoundedCornerShape(12.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            ) {
                LazyColumn(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(0.dp),
                ) {
                    items(suggestions) { stop ->
                        Text(
                            text = stop,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    query = stop
                                    onSelected(stop)
                                    showSuggestions = false
                                    focusManager.clearFocus()
                                }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Вибір часу як у Jakdojade: один ряд — режим (Вирушити о / Прибути до) + час + кнопки ±15 хв.
 */
@Composable
private fun TimeSelector(
    timeMinutes: Int,
    mode: PlannerTimeMode,
    onModeChange: (PlannerTimeMode) -> Unit,
    onShiftTime: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val hours = (timeMinutes / 60) % 24
    val mins = timeMinutes % 60
    val timeLabel = String.format("%02d:%02d", hours, mins)

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterChip(
            selected = mode == PlannerTimeMode.DEPART_AT,
            onClick = { onModeChange(PlannerTimeMode.DEPART_AT) },
            label = { Text("Вирушити о", style = MaterialTheme.typography.labelLarge) },
            leadingIcon = if (mode == PlannerTimeMode.DEPART_AT) {
                { Icon(Icons.Filled.Schedule, contentDescription = null, modifier = Modifier.padding(4.dp)) }
            } else null,
        )
        FilterChip(
            selected = mode == PlannerTimeMode.ARRIVE_BY,
            onClick = { onModeChange(PlannerTimeMode.ARRIVE_BY) },
            label = { Text("Прибути до", style = MaterialTheme.typography.labelLarge) },
            leadingIcon = if (mode == PlannerTimeMode.ARRIVE_BY) {
                { Icon(Icons.Filled.Schedule, contentDescription = null, modifier = Modifier.padding(4.dp)) }
            } else null,
        )
        Text(
            text = timeLabel,
            style = MaterialTheme.typography.titleMedium,
        )
        TextButton(onClick = { onShiftTime(-15) }) {
            Text("−15")
        }
        TextButton(onClick = { onShiftTime(15) }) {
            Text("+15")
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

/**
 * Картка рейсу як у застосунку Jakdojade: зліва номер маршруту, справа час у дорозі;
 * рядок відправлення → прибуття та зупинки.
 */
@Composable
private fun JourneyCard(journey: JourneyOption) {
    val depH = (journey.departureMinutes / 60) % 24
    val depM = journey.departureMinutes % 60
    val arrH = (journey.arrivalMinutes / 60) % 24
    val arrM = journey.arrivalMinutes % 60
    val depStr = String.format("%02d:%02d", depH, depM)
    val arrStr = String.format("%02d:%02d", arrH, arrM)
    val duration = journey.arrivalMinutes - journey.departureMinutes
    val durM = duration % 60
    val durH = duration / 60
    val durStr = if (durH > 0) "${durH} год ${durM} хв" else "${durM} хв"

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f),
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(
                        text = "№${journey.routeId}",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = "$depStr → $arrStr",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text = "${journey.fromStop} → ${journey.toStop}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                text = durStr,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

