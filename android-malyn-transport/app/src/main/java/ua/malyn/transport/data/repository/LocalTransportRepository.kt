package ua.malyn.transport.data.repository

import ua.malyn.transport.data.api.LocalTransportPayloadDto
import ua.malyn.transport.data.api.MalynTransportApi
import ua.malyn.transport.data.di.NetworkModule
import ua.malyn.transport.data.mapper.toRoutes
import ua.malyn.transport.domain.model.Route

class LocalTransportRepository(
    private val api: MalynTransportApi = NetworkModule.transportApi,
) {
    /**
     * Сирий payload з backend (/localtransport/data).
     * Використовується планувальником для побудови поїздок З→До.
     */
    suspend fun loadPayload(): LocalTransportPayloadDto {
        return api.getLocalTransportData()
    }

    /**
     * Спрощене представлення маршрутів (для списків/оглядів).
     */
    suspend fun loadRoutes(): List<Route> {
        val payload = loadPayload()
        return payload.toRoutes()
    }
}

