package ua.malyn.transport.ui.stops

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.PermissionChecker
import androidx.lifecycle.viewmodel.compose.viewModel
import ua.malyn.transport.domain.model.Direction

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StopsScreen(
    modifier: Modifier = Modifier,
    vm: StopsViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    var location by remember { mutableStateOf<Location?>(null) }
    var permissionDenied by remember { mutableStateOf(false) }
    var selectedDetails by remember { mutableStateOf<Pair<NearestStopUi, DepartureUi>?>(null) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            result[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            permissionDenied = false
            location = obtainLastLocation(context)
        } else {
            permissionDenied = true
        }
    }

    LaunchedEffect(location) {
        val loc = location
        if (loc != null) {
            vm.onLocationUpdate(loc.latitude, loc.longitude)
        }
    }

    Surface(modifier = modifier.fillMaxSize()) {
        when {
            state.loading -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                    Text(
                        text = "Завантаження даних…",
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
            }

            state.error != null -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = state.error ?: "Помилка",
                        color = MaterialTheme.colorScheme.error,
                    )
                    Button(onClick = { vm.onLocationUpdate(0.0, 0.0) }) {
                        Text("Повторити")
                    }
                }
            }

            else -> {
                StopsContent(
                    state = state,
                    hasLocation = location != null,
                    permissionDenied = permissionDenied,
                    onRequestLocation = {
                        val hasFine = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_FINE_LOCATION,
                        ) == PermissionChecker.PERMISSION_GRANTED
                        val hasCoarse = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        ) == PermissionChecker.PERMISSION_GRANTED
                        if (hasFine || hasCoarse) {
                            permissionDenied = false
                            location = obtainLastLocation(context)
                        } else {
                            launcher.launch(
                                arrayOf(
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION,
                                ),
                            )
                        }
                    },
                    onRadiusSelected = vm::onRadiusChange,
                    onRouteFilterChange = vm::onRouteFilterChange,
                    onDepartureClick = { stop, dep -> selectedDetails = stop to dep },
                )
            }
        }

        selectedDetails?.let { (stop, dep) ->
            ModalBottomSheet(
                onDismissRequest = { selectedDetails = null },
                sheetState = sheetState,
            ) {
                DepartureDetailsSheet(stop = stop, departure = dep)
            }
        }
    }
}

@Composable
private fun StopsContent(
    state: StopsUiState,
    hasLocation: Boolean,
    permissionDenied: Boolean,
    onRequestLocation: () -> Unit,
    onRadiusSelected: (Int) -> Unit,
    onRouteFilterChange: (String) -> Unit,
    onDepartureClick: (NearestStopUi, DepartureUi) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Найближчі зупинки",
            style = MaterialTheme.typography.titleMedium,
        )

        // Фильтры: радиус + номер маршрута
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RadiusChips(
                selectedRadius = state.radiusMeters,
                onRadiusSelected = onRadiusSelected,
            )
            OutlinedTextField(
                value = state.routeFilter,
                onValueChange = onRouteFilterChange,
                label = { Text("Маршрут") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
        }

        if (!hasLocation) {
            Text(
                text = if (permissionDenied) {
                    "Немає доступу до геолокації. Дозвольте доступ у налаштуваннях або спробуйте ще раз."
                } else {
                    "Натисніть кнопку нижче, щоб знайти найближчі зупинки."
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Button(
                onClick = onRequestLocation,
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Text("Знайти зупинки поруч")
            }
        }

        if (state.nearestStops.isEmpty() && hasLocation) {
            Text(
                text = "Немає зупинок поблизу або немає даних про координати.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (state.nearestStops.isNotEmpty()) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.nearestStops) { stop ->
                    StopCard(stop = stop, onDepartureClick = onDepartureClick)
                }
            }
        }
    }
}

@Composable
private fun RadiusChips(
    selectedRadius: Int,
    onRadiusSelected: (Int) -> Unit,
) {
    val options = listOf(
        300 to "300 м",
        700 to "700 м",
        1500 to "1.5 км",
        -1 to "Усі",
    )
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (radius, label) ->
            FilterChip(
                selected = selectedRadius == radius,
                onClick = { onRadiusSelected(radius) },
                label = { Text(label) },
            )
        }
    }
}

@Composable
private fun StopCard(
    stop: NearestStopUi,
    onDepartureClick: (NearestStopUi, DepartureUi) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = stop.name,
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = "${stop.distanceMeters} м від вас",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (stop.departures.isEmpty()) {
                Text(
                    text = "Немає найближчих відправлень.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            } else {
                Text(
                    text = "Найближчі відправлення:",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 4.dp),
                )
                stop.departures.forEach { dep ->
                    val h = (dep.departureMinutes / 60) % 24
                    val m = dep.departureMinutes % 60
                    val timeStr = String.format("%02d:%02d", h, m)
                    val dirStr = when (dep.direction) {
                        Direction.THERE -> "туди"
                        Direction.BACK -> "назад"
                    }
                    Text(
                        text = "• №${dep.routeId} о $timeStr ($dirStr)",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                            .clickable { onDepartureClick(stop, dep) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DepartureDetailsSheet(
    stop: NearestStopUi,
    departure: DepartureUi,
) {
    val h = (departure.departureMinutes / 60) % 24
    val m = departure.departureMinutes % 60
    val timeStr = String.format("%02d:%02d", h, m)
    val dirStr = when (departure.direction) {
        Direction.THERE -> "туди"
        Direction.BACK -> "назад"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Рейс №${departure.routeId}",
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = "Зупинка: ${stop.name}",
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = "Час відправлення: $timeStr ($dirStr)",
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = "${stop.distanceMeters} м від вас",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@SuppressLint("MissingPermission")
private fun obtainLastLocation(context: Context): Location? {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
    val providers = listOf(
        LocationManager.GPS_PROVIDER,
        LocationManager.NETWORK_PROVIDER,
        LocationManager.PASSIVE_PROVIDER,
    )
    for (p in providers) {
        val loc = lm.getLastKnownLocation(p)
        if (loc != null) return loc
    }
    return null
}

