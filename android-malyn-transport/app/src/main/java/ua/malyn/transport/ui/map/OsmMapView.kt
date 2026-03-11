package ua.malyn.transport.ui.map

import android.graphics.Color
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Polyline
import ua.malyn.transport.domain.model.Stop

/** Центр Малина */
val MALYN_CENTER = GeoPoint(50.768, 29.242)

/**
 * OpenStreetMap карта для екрану маршруту.
 * Показує точки зупинок і полілінію між ними.
 */
@Composable
fun OsmMapView(
    modifier: Modifier = Modifier,
    stops: List<Stop> = emptyList(),
    center: GeoPoint = MALYN_CENTER,
    zoomLevel: Double = 14.0,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val mapView = remember {
        MapView(context).apply {
            id = android.view.View.generateViewId()
            setTileSource(TileSourceFactory.MAPNIK)
            controller.setCenter(center)
            controller.setZoom(zoomLevel)
            setMultiTouchControls(true)
        }
    }

    val routeOverlays = remember { mutableListOf<Any>() }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    AndroidView(
        modifier = modifier,
        factory = {
            Log.d("OsmMap", "OsmMapView factory: creating map")
            mapView
        },
        update = {
            val stopsToUse = stops
            it.post {
                Log.d("OsmMap", "OsmMapView update: stops=${stopsToUse.size}")
                routeOverlays.forEach { overlay ->
                    it.overlays.remove(overlay)
                }
                routeOverlays.clear()

                if (stopsToUse.isNotEmpty()) {
                    val points = stopsToUse.map { GeoPoint(it.lat, it.lng) }

                    // Зелена лінія маршруту (як у Jakdojade)
                    val polyline = Polyline().apply {
                        setPoints(points)
                        outlinePaint.color = Color.parseColor("#4CAF50")
                        outlinePaint.strokeWidth = 14f
                    }
                    it.overlays.add(0, polyline)
                    routeOverlays.add(polyline)

                    // Нумеровані кружечки: 0 — старт, 1..n-1 — проміжні, остання — синій
                    val numberedPoints = stopsToUse.mapIndexed { index, stop ->
                        val label = when {
                            index == 0 -> "0"
                            index == stopsToUse.lastIndex -> "До"
                            else -> "$index"
                        }
                        GeoPoint(stop.lat, stop.lng) to label
                    }
                    val overlay = NumberedCircleOverlay(it.context, numberedPoints)
                    it.overlays.add(overlay)
                    routeOverlays.add(overlay)

                    when {
                        points.size >= 2 -> {
                            val lats = points.map { it.latitude }
                            val lngs = points.map { it.longitude }
                            val bounds = org.osmdroid.util.BoundingBox(
                                lats.max(),
                                lngs.max(),
                                lats.min(),
                                lngs.min(),
                            )
                            it.zoomToBoundingBox(bounds, false, 80)
                        }
                        points.size == 1 -> {
                            it.controller.setCenter(points[0])
                            it.controller.setZoom(17.0)
                        }
                    }
                }
                it.invalidate()
            }
        },
    )
}
