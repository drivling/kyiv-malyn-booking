package ua.malyn.transport.ui.schedule

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import ua.malyn.transport.data.api.LocalTransportPayloadDto
import ua.malyn.transport.data.repository.LocalTransportRepository
import ua.malyn.transport.domain.model.Direction
import ua.malyn.transport.domain.model.Stop

data class ScheduleUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val routeIds: List<String> = emptyList(),
    val selectedRouteId: String? = null,
    val selectedRouteFrom: String? = null,
    val selectedRouteTo: String? = null,
    val mapStops: List<Stop> = emptyList(),
    val direction: Direction = Direction.THERE,
)

class ScheduleViewModel(
    private val repository: LocalTransportRepository = LocalTransportRepository(),
) : ViewModel() {

    private val _state = MutableStateFlow(ScheduleUiState())
    val state: StateFlow<ScheduleUiState> = _state

    private var payload: LocalTransportPayloadDto? = null

    init {
        loadRoutes()
    }

    fun loadRoutes() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val data = repository.loadPayload()
                payload = data
                val ids = data.transport.supplement?.stops?.stops_by_route?.keys
                    ?.toList()
                    ?.sortedBy { it.toIntOrNull() ?: Int.MAX_VALUE }
                    ?: emptyList()
                _state.value = _state.value.copy(
                    loading = false,
                    error = null,
                    routeIds = ids,
                )
            } catch (e: Exception) {
                Log.e("Schedule", "loadRoutes failed", e)
                _state.value = _state.value.copy(
                    loading = false,
                    error = e.message ?: "Помилка завантаження",
                    routeIds = emptyList(),
                )
            }
        }
    }

    fun onRouteSelected(routeId: String) {
        val data = payload ?: return
        val stopsByRoute = data.transport.supplement?.stops?.stops_by_route ?: return
        val routeStops = stopsByRoute[routeId] ?: return
        val coords = data.coords.stops

        val supRoute = data.transport.supplement?.routes?.get(routeId)
        val direction = _state.value.direction

        val orderedNames = if (direction == Direction.THERE) {
            routeStops
                .filter { (it.belongs_to ?: "both") != "back" && (it.order_there ?: 0) > 0 }
                .sortedBy { it.order_there ?: 0 }
                .map { it.name }
        } else {
            routeStops
                .filter { (it.belongs_to ?: "both") != "there" && (it.order_back ?: 0) > 0 }
                .sortedBy { it.order_back ?: 0 }
                .map { it.name }
        }

        val mapStops = orderedNames.mapNotNull { name ->
            val c = coords[name]
            if (c != null && c.size >= 2) {
                Stop(name = name, lat = c[0], lng = c[1])
            } else null
        }

        _state.value = _state.value.copy(
            selectedRouteId = routeId,
            selectedRouteFrom = supRoute?.from,
            selectedRouteTo = supRoute?.to,
            mapStops = mapStops,
        )
    }

    fun onRouteDetailClosed() {
        _state.value = _state.value.copy(
            selectedRouteId = null,
            selectedRouteFrom = null,
            selectedRouteTo = null,
            mapStops = emptyList(),
        )
    }

    fun toggleDirection() {
        val s = _state.value
        val routeId = s.selectedRouteId ?: return
        val newDir = if (s.direction == Direction.THERE) Direction.BACK else Direction.THERE
        _state.value = s.copy(direction = newDir)
        onRouteSelected(routeId)
    }
}
