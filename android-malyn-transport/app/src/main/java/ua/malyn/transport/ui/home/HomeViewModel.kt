package ua.malyn.transport.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import ua.malyn.transport.data.repository.LocalTransportRepository
import ua.malyn.transport.domain.model.Direction
import ua.malyn.transport.domain.model.JourneyOption
import ua.malyn.transport.domain.model.PlannerTimeMode
import kotlin.math.min

data class HomeUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val allStops: List<String> = emptyList(),
    val fromStop: String = "",
    val toStop: String = "",
    val timeMode: PlannerTimeMode = PlannerTimeMode.DEPART_AT,
    val timeMinutes: Int = 0,
    val journeys: List<JourneyOption> = emptyList(),
)

class HomeViewModel(
    private val repository: LocalTransportRepository = LocalTransportRepository(),
) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state

    private var payload: ua.malyn.transport.data.api.LocalTransportPayloadDto? = null

    init {
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val data = repository.loadPayload()
                payload = data

                // Побудувати список усіх зупинок з supplement.stops.stops_by_route
                val allStops = data.transport.supplement
                    ?.stops
                    ?.stops_by_route
                    ?.values
                    ?.flatten()
                    ?.mapNotNull { it.name }
                    ?.distinct()
                    ?.sorted()
                    ?: emptyList()

                val now = currentTimeMinutes()

                _state.value = _state.value.copy(
                    loading = false,
                    error = null,
                    allStops = allStops,
                    timeMinutes = now,
                )

                recalcJourneys()
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = e.message ?: "Помилка завантаження",
                    allStops = emptyList(),
                    journeys = emptyList(),
                )
            }
        }
    }

    fun onFromStopSelected(stop: String) {
        _state.value = _state.value.copy(fromStop = stop)
        recalcJourneys()
    }

    fun onToStopSelected(stop: String) {
        _state.value = _state.value.copy(toStop = stop)
        recalcJourneys()
    }

    fun onSwapStops() {
        val current = _state.value
        _state.value = current.copy(
            fromStop = current.toStop,
            toStop = current.fromStop,
        )
        recalcJourneys()
    }

    fun onTimeModeChanged(mode: PlannerTimeMode) {
        _state.value = _state.value.copy(timeMode = mode)
        recalcJourneys()
    }

    fun shiftTimeBy(deltaMinutes: Int) {
        val current = _state.value
        val newTime = ((current.timeMinutes + deltaMinutes) % (24 * 60) + (24 * 60)) % (24 * 60)
        _state.value = current.copy(timeMinutes = newTime)
        recalcJourneys()
    }

    private fun recalcJourneys() {
        val data = payload ?: return
        val s = _state.value
        val from = s.fromStop
        val to = s.toStop
        if (from.isBlank() || to.isBlank() || from == to) {
            _state.value = s.copy(journeys = emptyList())
            return
        }

        val journeys = buildJourneys(
            data = data,
            fromStop = from,
            toStop = to,
            timeMinutes = s.timeMinutes,
            mode = s.timeMode,
        )
        _state.value = s.copy(journeys = journeys)
    }

    private fun buildJourneys(
        data: ua.malyn.transport.data.api.LocalTransportPayloadDto,
        fromStop: String,
        toStop: String,
        timeMinutes: Int,
        mode: PlannerTimeMode,
    ): List<JourneyOption> {
        val supplement = data.transport.supplement ?: return emptyList()
        val stopsByRoute = supplement.stops?.stops_by_route ?: return emptyList()
        val segments = data.segments

        val records = data.transport.records

        val journeys = mutableListOf<JourneyOption>()

        for ((routeId, stopsForRoute) in stopsByRoute) {
            if (stopsForRoute.isEmpty()) continue

            // there
            val orderedThere = stopsForRoute
                .filter { (it.belongs_to ?: "both") != "back" && (it.order_there ?: 0) > 0 }
                .sortedBy { it.order_there ?: 0 }
                .mapNotNull { it.name }

            // back
            val orderedBack = stopsForRoute
                .filter { (it.belongs_to ?: "both") != "there" && (it.order_back ?: 0) > 0 }
                .sortedBy { it.order_back ?: 0 }
                .mapNotNull { it.name }

            val supRoute = supplement.routes?.get(routeId)

            // Обробка напрямку there (direction_id == "1")
            journeys += buildJourneysForDirection(
                routeId = routeId,
                routeFrom = supRoute?.from,
                routeTo = supRoute?.to,
                direction = Direction.THERE,
                orderedStops = orderedThere,
                records = records,
                dirId = "1",
                fromStop = fromStop,
                toStop = toStop,
                timeMinutes = timeMinutes,
                mode = mode,
                segments = segments,
            )

            // Обробка напрямку back (direction_id == "0")
            journeys += buildJourneysForDirection(
                routeId = routeId,
                routeFrom = supRoute?.from,
                routeTo = supRoute?.to,
                direction = Direction.BACK,
                orderedStops = orderedBack,
                records = records,
                dirId = "0",
                fromStop = fromStop,
                toStop = toStop,
                timeMinutes = timeMinutes,
                mode = mode,
                segments = segments,
            )
        }

        return when (mode) {
            PlannerTimeMode.DEPART_AT ->
                journeys
                    .filter { it.departureMinutes >= timeMinutes }
                    .sortedBy { it.departureMinutes }
                    .take(30)

            PlannerTimeMode.ARRIVE_BY ->
                journeys
                    .filter { it.arrivalMinutes <= timeMinutes }
                    .sortedByDescending { it.arrivalMinutes }
                    .take(30)
        }
    }

    private fun buildJourneysForDirection(
        routeId: String,
        routeFrom: String?,
        routeTo: String?,
        direction: Direction,
        orderedStops: List<String>,
        records: List<ua.malyn.transport.data.api.TransportRecordDto>,
        dirId: String,
        fromStop: String,
        toStop: String,
        timeMinutes: Int,
        mode: PlannerTimeMode,
        segments: ua.malyn.transport.data.api.SegmentDurationsDto,
    ): List<JourneyOption> {
        if (orderedStops.isEmpty()) return emptyList()
        val fromIndex = orderedStops.indexOf(fromStop)
        val toIndex = orderedStops.indexOf(toStop)
        if (fromIndex == -1 || toIndex == -1 || fromIndex >= toIndex) return emptyList()

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

        val depOffset = durationFromStartMinutes(routeId, orderedStops, fromIndex, segments)
        val arrOffset = durationFromStartMinutes(routeId, orderedStops, toIndex, segments)

        val result = mutableListOf<JourneyOption>()

        for (base in baseRecords) {
            val dep = base + depOffset
            val arr = base + arrOffset

            // Попередній фільтр по часу, щоб не будувати зайве
            val matches = when (mode) {
                PlannerTimeMode.DEPART_AT -> dep >= timeMinutes
                PlannerTimeMode.ARRIVE_BY -> arr <= timeMinutes
            }
            if (!matches) continue

            result += JourneyOption(
                routeId = routeId,
                routeFrom = routeFrom,
                routeTo = routeTo,
                direction = direction,
                fromStop = fromStop,
                toStop = toStop,
                departureMinutes = dep,
                arrivalMinutes = arr,
            )
        }

        return result
    }

    private fun durationFromStartMinutes(
        routeId: String,
        orderedStops: List<String>,
        toIndex: Int,
        segments: ua.malyn.transport.data.api.SegmentDurationsDto,
    ): Int {
        var sec = 0
        val last = min(toIndex, orderedStops.size - 1)
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
}

