package ua.malyn.transport.ui.schedule

import android.app.Activity
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable
fun ScheduleScreen(
    modifier: Modifier = Modifier,
    vm: ScheduleViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()

    Surface(modifier = modifier.fillMaxSize()) {
        when {
            state.loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
            state.error != null -> Box(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = state.error ?: "Помилка",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            state.selectedRouteId != null -> ScheduleRouteMapScreen(
                routeId = state.selectedRouteId!!,
                routeFrom = state.selectedRouteFrom,
                routeTo = state.selectedRouteTo,
                mapStops = state.mapStops,
                direction = state.direction,
                onClose = vm::onRouteDetailClosed,
                onToggleDirection = vm::toggleDirection,
            )
            else -> {
                val view = LocalView.current
                val window = (view.context as? Activity)?.window
                DisposableEffect(window) {
                    if (window != null) {
                        val controller = WindowCompat.getInsetsController(window, view)
                        val wasLight = controller.isAppearanceLightStatusBars
                        controller.isAppearanceLightStatusBars = true
                        onDispose { controller.isAppearanceLightStatusBars = wasLight }
                    } else {
                        onDispose { }
                    }
                }
                ScheduleRoutesList(
                    routeIds = state.routeIds,
                    onRouteClick = vm::onRouteSelected,
                )
            }
        }
    }
}

@Composable
private fun ScheduleRoutesList(
    routeIds: List<String>,
    onRouteClick: (String) -> Unit,
) {
    var searchQuery by mutableStateOf("")
    val filtered = if (searchQuery.isBlank()) {
        routeIds
    } else {
        routeIds.filter { it.contains(searchQuery, ignoreCase = true) }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            placeholder = { Text("Пошук маршруту") },
            singleLine = true,
        )
        Text(
            text = "Малин транспорт",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 64.dp),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(filtered) { routeId ->
                Card(
                    modifier = Modifier
                        .size(64.dp)
                        .clickable { onRouteClick(routeId) },
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = routeId,
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}
