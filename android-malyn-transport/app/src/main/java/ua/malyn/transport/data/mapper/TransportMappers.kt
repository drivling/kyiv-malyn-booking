package ua.malyn.transport.data.mapper

import ua.malyn.transport.data.api.LocalTransportPayloadDto
import ua.malyn.transport.data.api.TransportRecordDto
import ua.malyn.transport.domain.model.Direction
import ua.malyn.transport.domain.model.Route
import ua.malyn.transport.domain.model.Trip

private fun parseTimeMinutes(blockId: String?): Int {
    if (blockId == null) return 0
    // В web-версии block_id уже заменён на HH:MM; если формат другой, просто вернём 0
    val m = Regex("""^(\d{1,2}):(\d{2})$""").matchEntire(blockId) ?: return 0
    val h = m.groupValues[1].toIntOrNull() ?: return 0
    val min = m.groupValues[2].toIntOrNull() ?: return 0
    return h * 60 + min
}

fun LocalTransportPayloadDto.toRoutes(): List<Route> {
    val byRoute = linkedMapOf<String, MutableList<TransportRecordDto>>()
    for (r in transport.records) {
        byRoute.getOrPut(r.route_id) { mutableListOf() }.add(r)
    }

    val supplementRoutes = transport.supplement?.routes.orEmpty()

    return byRoute.entries.map { (id, list) ->
        val sup = supplementRoutes[id]
        val from = sup?.from
        val to = sup?.to
        val trips = list.map { rec ->
            Trip(
                id = rec.trip_id,
                routeId = rec.route_id,
                direction = if (rec.direction_id == "0") Direction.BACK else Direction.THERE,
                baseTimeMinutes = parseTimeMinutes(rec.block_id),
            )
        }.sortedBy { it.baseTimeMinutes }

        Route(
            id = id,
            from = from,
            to = to,
            trips = trips,
        )
    }.sortedBy { it.id.toIntOrNull() ?: Int.MAX_VALUE }
}

