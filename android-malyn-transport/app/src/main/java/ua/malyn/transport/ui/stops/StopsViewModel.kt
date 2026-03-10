package ua.malyn.transport.ui.stops

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import ua.malyn.transport.data.api.LocalTransportPayloadDto
import ua.malyn.transport.data.repository.LocalTransportRepository
import ua.malyn.transport.domain.model.Direction
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

data class StopsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val nearestStops: List<NearestStopUi> = emptyList(),
    val radiusMeters: Int = 700,
    val routeFilter: String = "",
)

data class NearestStopUi(
    val name: String,
    val distanceMeters: Int,
    val departures: List<DepartureUi>,
)

data class DepartureUi(
    val routeId: String,
    val direction: Direction,
    val departureMinutes: Int,
)

class StopsViewModel(
    private val repository: LocalTransportRepository = LocalTransportRepository(),
) : ViewModel() {

    private val _state = MutableStateFlow(StopsUiState())
    val state: StateFlow<StopsUiState> = _state

    private var payload: LocalTransportPayloadDto? = null

    private var lastLat: Double? = null
    private var lastLng: Double? = null

    init {
        preloadData()
    }

    private fun preloadData() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                payload = repository.loadPayload()
                _state.value = _state.value.copy(loading = false, error = null)
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = e.message ?: "Помилка завантаження",
                )
            }
        }
    }

    fun onLocationUpdate(lat: Double, lng: Double) {
        lastLat = lat
        lastLng = lng
        recalcNearest()
    }

    fun onRadiusChange(radius: Int) {
        _state.value = _state.value.copy(radiusMeters = radius)
        recalcNearest()
    }

    fun onRouteFilterChange(filter: String) {
        _state.value = _state.value.copy(routeFilter = filter)
        recalcNearest()
    }

    private fun recalcNearest() {
        val data = payload ?: return
        val lat = lastLat
        val lng = lastLng
        if (lat == null || lng == null) return

        val now = currentTimeMinutes()
        val nearest = buildNearestStopsWithDepartures(data, lat, lng, now)
        _state.value = _state.value.copy(
            error = null,
            nearestStops = nearest,
        )
    }

    private fun buildNearestStopsWithDepartures(
        data: LocalTransportPayloadDto,
        lat: Double,
        lng: Double,
        nowMinutes: Int,
    ): List<NearestStopUi> {
        val coords = data.coords.stops
        if (coords.isEmpty()) return emptyList()

        val radius = _state.value.radiusMeters
        val routeFilter = _state.value.routeFilter.trim()

        // расстояния до всех зупинок
        val allWithDistance = coords.mapNotNull { (name, coord) ->
            val stopLat = coord.getOrNull(0) ?: return@mapNotNull null
            val stopLng = coord.getOrNull(1) ?: return@mapNotNull null
            val d = haversine(lat, lng, stopLat, stopLng).roundToInt()
            name to d
        }

        val topStops = allWithDistance
            .sortedBy { it.second }
            .filter { it.second <= radius || radius <= 0 }
            .take(20)

        if (topStops.isEmpty()) return emptyList()

        val supplement = data.transport.supplement ?: return emptyList()
        val stopsByRoute = supplement.stops?.stops_by_route ?: return emptyList()
        val segments = data.segments
        val records = data.transport.records

        return topStops.map { (stopName, distance) ->
            val departures = buildDeparturesForStop(
                stopName = stopName,
                nowMinutes = nowMinutes,
                stopsByRoute = stopsByRoute,
                segments = segments,
                records = records,
            )
                .let { deps ->
                    if (routeFilter.isBlank()) deps
                    else deps.filter { it.routeId.contains(routeFilter, ignoreCase = true) }
                }
            NearestStopUi(
                name = stopName,
                distanceMeters = distance,
                departures = departures,
            )
        }
    }

    private fun buildDeparturesForStop(
        stopName: String,
        nowMinutes: Int,
        stopsByRoute: Map<String, List<ua.malyn.transport.data.api.RouteStopWithOrderDto>>,
        segments: ua.malyn.transport.data.api.SegmentDurationsDto,
        records: List<ua.malyn.transport.data.api.TransportRecordDto>,
    ): List<DepartureUi> {
        val result = mutableListOf<DepartureUi>()

        for ((routeId, stopsForRoute) in stopsByRoute) {
            if (stopsForRoute.isEmpty()) continue

            val orderedThere = stopsForRoute
                .filter { (it.belongs_to ?: "both") != "back" && (it.order_there ?: 0) > 0 }
                .sortedBy { it.order_there ?: 0 }
                .mapNotNull { it.name }

            val orderedBack = stopsForRoute
                .filter { (it.belongs_to ?: "both") != "there" && (it.order_back ?: 0) > 0 }
                .sortedBy { it.order_back ?: 0 }
                .mapNotNull { it.name }

            result += buildDeparturesForDirection(
                stopName = stopName,
                nowMinutes = nowMinutes,
                routeId = routeId,
                direction = Direction.THERE,
                orderedStops = orderedThere,
                records = records,
                dirId = "1",
                segments = segments,
            )

            result += buildDeparturesForDirection(
                stopName = stopName,
                nowMinutes = nowMinutes,
                routeId = routeId,
                direction = Direction.BACK,
                orderedStops = orderedBack,
                records = records,
                dirId = "0",
                segments = segments,
            )
        }

        return result
            .filter { it.departureMinutes >= nowMinutes }
            .sortedBy { it.departureMinutes }
            .take(8)
    }

    private fun buildDeparturesForDirection(
        stopName: String,
        nowMinutes: Int,
        routeId: String,
        direction: Direction,
        orderedStops: List<String>,
        records: List<ua.malyn.transport.data.api.TransportRecordDto>,
        dirId: String,
        segments: ua.malyn.transport.data.api.SegmentDurationsDto,
    ): List<DepartureUi> {
        if (orderedStops.isEmpty()) return emptyList()
        val index = orderedStops.indexOf(stopName)
        if (index == -1) return emptyList()

        val baseRecords = records
            .asSequence()
            .filter { it.route_id == routeId && it.direction_id == dirId }
            .mapNotNull { rec ->
                val mins = parseTimeMinutes(rec.block_id)
                if (mins > 0) mins else null
            }
            .sorted()
            .toList()

        if (baseRecords.isEmpty()) return emptyList()

        val offset = durationFromStartMinutes(routeId, orderedStops, index, segments)

        val list = mutableListOf<DepartureUi>()
        for (base in baseRecords) {
            val dep = base + offset
            if (dep >= nowMinutes) {
                list += DepartureUi(
                    routeId = routeId,
                    direction = direction,
                    departureMinutes = dep,
                )
            }
        }
        return list
    }

    private fun durationFromStartMinutes(
        routeId: String,
        orderedStops: List<String>,
        toIndex: Int,
        segments: ua.malyn.transport.data.api.SegmentDurationsDto,
    ): Int {
        var sec = 0
        val last = kotlin.math.min(toIndex, orderedStops.size - 1)
        for (i in 0 until last) {
            val a = orderedStops[i]
            val b = orderedStops[i + 1]
            sec += segmentDurationSec(routeId, a, b, segments)
        }
        return sec / 60
    }

    private fun segmentDurationSec(
        routeId: String,
        from: String,
        to: String,
        segments: ua.malyn.transport.data.api.SegmentDurationsDto,
    ): Int {
        val key1 = "$routeId|$from|$to"
        val key2 = "$routeId|$to|$from"
        return segments.segments[key1]
            ?: segments.segments[key2]
            ?: segments.defaultSec
    }

    private fun parseTimeMinutes(blockId: String?): Int {
        if (blockId == null) return 0
        val match = Regex("""^(\d{1,2}):(\d{2})$""").matchEntire(blockId) ?: return 0
        val h = match.groupValues[1].toIntOrNull() ?: return 0
        val m = match.groupValues[2].toIntOrNull() ?: return 0
        return h * 60 + m
    }

    private fun currentTimeMinutes(): Int {
        val now = java.time.LocalTime.now()
        return now.hour * 60 + now.minute
    }

    private fun haversine(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double,
    ): Double {
        val r = 6371_000.0 // meters
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val dPhi = Math.toRadians(lat2 - lat1)
        val dLambda = Math.toRadians(lon2 - lon1)

        val a = sin(dPhi / 2) * sin(dPhi / 2) +
            cos(phi1) * cos(phi2) *
            sin(dLambda / 2) * sin(dLambda / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return r * c
    }
}

