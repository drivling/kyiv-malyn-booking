package ua.malyn.transport.domain.model

data class Route(
    val id: String,
    val from: String?,
    val to: String?,
    val trips: List<Trip>,
)

data class Trip(
    val id: String,
    val routeId: String,
    val direction: Direction,
    val baseTimeMinutes: Int,
)

enum class Direction { THERE, BACK }

data class Stop(
    val name: String,
    val lat: Double,
    val lng: Double,
)

data class RouteStopOrder(
    val routeId: String,
    val stopName: String,
    val orderThere: Int?,
    val orderBack: Int?,
    val belongsTo: BelongsTo,
)

enum class BelongsTo { THERE, BACK, BOTH }

data class SegmentDuration(
    val routeId: String,
    val fromStop: String,
    val toStop: String,
    val durationSec: Int,
)

data class Fare(
    val amount: Int,
    val currency: String,
)

/**
 * Результат пошуку поїздки «З → До» для планувальника.
 */
data class JourneyOption(
    val routeId: String,
    val routeFrom: String?,
    val routeTo: String?,
    val direction: Direction,
    val fromStop: String,
    val toStop: String,
    val departureMinutes: Int,
    val arrivalMinutes: Int,
)

/**
 * Режим часу: «Вирушити о» або «Прибути до».
 */
enum class PlannerTimeMode {
    DEPART_AT,
    ARRIVE_BY,
}


