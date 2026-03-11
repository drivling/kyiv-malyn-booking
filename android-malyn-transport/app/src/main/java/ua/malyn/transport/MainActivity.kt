package ua.malyn.transport

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import org.osmdroid.config.Configuration
import ua.malyn.transport.ui.AppRoot
import ua.malyn.transport.ui.theme.MalynTransportTheme
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // osmdroid init у фоні, щоб не блокувати UI
        Executors.newSingleThreadExecutor().execute {
            Configuration.getInstance().load(applicationContext, getSharedPreferences("osmdroid", MODE_PRIVATE))
            Configuration.getInstance().userAgentValue = "MalynTransport/1.0"
            runOnUiThread {
                setContent {
                    MalynTransportTheme {
                        Surface(color = MaterialTheme.colorScheme.background) {
                            AppRoot()
                        }
                    }
                }
            }
        }
    }
}

