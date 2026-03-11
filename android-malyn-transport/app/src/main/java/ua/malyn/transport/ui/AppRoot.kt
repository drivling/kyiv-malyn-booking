package ua.malyn.transport.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.collectAsState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import ua.malyn.transport.R
import ua.malyn.transport.ui.home.HomeScreen
import ua.malyn.transport.ui.stops.StopsScreen

private sealed class RootDestination(
    val route: String,
    val labelRes: Int,
    val iconRes: Int,
) {
    data object Planner : RootDestination("planner", R.string.nav_planner, R.drawable.ic_nav_planner)
    data object Stops : RootDestination("stops", R.string.nav_stops, R.drawable.ic_nav_stops)
    data object Tickets : RootDestination("tickets", R.string.nav_tickets, R.drawable.ic_nav_tickets)
    data object Profile : RootDestination("profile", R.string.nav_profile, R.drawable.ic_nav_profile)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot() {
    val navController = rememberNavController()
    val destinations = listOf(
        RootDestination.Planner,
        RootDestination.Stops,
        RootDestination.Tickets,
        RootDestination.Profile,
    )

    val homeVm: ua.malyn.transport.ui.home.HomeViewModel = viewModel()
    val homeState by homeVm.state.collectAsState()

    Scaffold(
        topBar = {
            val navBackStackEntry by navController.currentBackStackEntryAsState()
            val currentRoute = navBackStackEntry?.destination?.route
            when (currentRoute) {
                RootDestination.Planner.route -> {
                    if (homeState.selectedJourney != null) {
                        TopAppBar(
                            navigationIcon = {
                                IconButton(onClick = homeVm::onJourneyClosed) {
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                        contentDescription = "Назад",
                                    )
                                }
                            },
                            title = {},
                        )
                    } else {
                        TopAppBar(
                            title = {},
                        )
                    }
                }
                RootDestination.Stops.route -> {
                    TopAppBar(title = { Text("Зупинки") })
                }
                RootDestination.Tickets.route -> {
                    TopAppBar(title = { Text("Квитки") })
                }
                RootDestination.Profile.route -> {
                    TopAppBar(title = { Text("Профіль") })
                }
                else -> {
                    TopAppBar(title = {})
                }
            }
        },
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination
                destinations.forEach { dest ->
                    val selected = currentDestination?.hierarchy?.any { it.route == dest.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            if (!selected) {
                                navController.navigate(dest.route) {
                                    popUpTo(navController.graph.startDestinationId) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        },
                        icon = {
                            Icon(
                                imageVector = ImageVector.vectorResource(id = dest.iconRes),
                                contentDescription = null,
                            )
                        },
                        label = { Text(stringResource(id = dest.labelRes)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = RootDestination.Planner.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(RootDestination.Planner.route) {
                // Планувальник/список маршрутів (аналог головного екрану Jakdojade)
                HomeScreen(modifier = Modifier, vm = homeVm)
            }
            composable(RootDestination.Stops.route) {
                StopsScreen(modifier = Modifier)
            }
            composable(RootDestination.Tickets.route) {
                // TODO: екран покупки квитків
                Text("Квитки (поки заглушка)")
            }
            composable(RootDestination.Profile.route) {
                // TODO: екран профілю / налаштувань
                Text("Профіль (поки заглушка)")
            }
        }
    }
}


