package ua.malyn.transport.data.api

import retrofit2.http.GET
import retrofit2.http.Query

/**
 * Сетевое API для транспорта.
 *
 * Сейчас backend явно не отдает malyn_transport/stops_coords/segmentDurations,
 * поэтому эндпоинты помечены как TODO. Когда добавим REST в backend, достаточно
 * будет подставить реальные пути и DTO.
 */
interface MalynTransportApi {
    // TODO: добавить в backend: GET /localtransport/data (объединённый payload)
    // или несколько эндпоинтов: /localtransport/malyn_transport.json,
    // /localtransport/stops_coords.json, /localtransport/segmentDurations.json.
    @GET("/localtransport/data")
    suspend fun getLocalTransportData(
        @Query("version") version: Int? = null,
    ): LocalTransportPayloadDto
}

/**
 * DTO под будущий API, логически соответствует фронтовым JSON:
 * - malyn_transport.json
 * - stops_coords.json
 * - segmentDurations.json
 */
data class LocalTransportPayloadDto(
    val transport: TransportDataDto,
    val coords: StopsCoordsDto,
    val segments: SegmentDurationsDto,
)

data class TransportDataDto(
    val records: List<TransportRecordDto>,
    val supplement: TransportSupplementDto?,
)

data class TransportRecordDto(
    val route_id: String,
    val service_id: String,
    val trip_id: String,
    val trip_headsign: String,
    val direction_id: String,
    val block_id: String?,
)

data class TransportSupplementDto(
    val routes: Map<String, SupplementRouteDto>?,
    val stops: SupplementStopsDto?,
    val fare: FareDto?,
)

data class SupplementRouteDto(
    val from: String?,
    val to: String?,
)

data class SupplementStopsDto(
    val stops_by_route: Map<String, List<RouteStopWithOrderDto>>?,
)

data class RouteStopWithOrderDto(
    val name: String,
    val order_there: Int?,
    val order_back: Int?,
    val belongs_to: String?, // "there" | "back" | "both"
)

data class FareDto(
    val amount: Int,
    val currency: String?,
)

data class StopsCoordsDto(
    val center: List<Double>,
    val stops: Map<String, List<Double>>,
)

data class SegmentDurationsDto(
    val defaultSec: Int,
    val segments: Map<String, Int>,
)

