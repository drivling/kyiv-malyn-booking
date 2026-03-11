package ua.malyn.transport.ui.map

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Point
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Overlay

/**
 * Кастомний overlay — нумеровані кружечки на карті (як у Jakdojade).
 * Старт — зелений круг з "0", проміжні — зелені з 1,2,3..., фініш — синій круг.
 */
class NumberedCircleOverlay(
    context: Context,
    private val points: List<Pair<GeoPoint, String>>,
) : Overlay(context) {

    private val circlePaint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.FILL
    }

    private val strokePaint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = android.graphics.Color.WHITE
    }

    private val textPaint = Paint().apply {
        isAntiAlias = true
        textAlign = Paint.Align.CENTER
        color = android.graphics.Color.WHITE
    }

    override fun draw(canvas: Canvas, mapView: MapView, shadow: Boolean) {
        if (shadow) return
        if (points.isEmpty()) return

        val projection = mapView.projection
        val radiusPx = 18f
        val screenPoint = Point()

        points.forEachIndexed { index, (geoPoint, label) ->
            projection.toPixels(geoPoint, screenPoint)

            val isLast = index == points.lastIndex
            val color = if (isLast) {
                android.graphics.Color.parseColor("#2196F3")
            } else {
                android.graphics.Color.parseColor("#4CAF50")
            }

            circlePaint.color = color
            canvas.drawCircle(screenPoint.x.toFloat(), screenPoint.y.toFloat(), radiusPx, circlePaint)
            canvas.drawCircle(screenPoint.x.toFloat(), screenPoint.y.toFloat(), radiusPx, strokePaint)

            textPaint.textSize = if (label.length <= 2) 22f else 16f
            val textY = screenPoint.y - (textPaint.descent() + textPaint.ascent()) / 2
            canvas.drawText(label, screenPoint.x.toFloat(), textY, textPaint)
        }
    }
}
