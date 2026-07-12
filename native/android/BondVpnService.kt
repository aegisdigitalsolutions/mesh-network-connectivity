package com.meshlink.app.bond

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * MeshLink bonding VPN service.
 *
 * Responsibilities:
 *  1. Establish an Android tun interface via VpnService (the ONLY way to get a tun
 *     without root on modern Android).
 *  2. Hold Wi-Fi + cellular simultaneously via ConnectivityManager.requestNetwork(),
 *     so both radios stay up at once.
 *  3. Launch the bundled glorytun binary, handing it the tun file descriptor from
 *     establish(), pointed at the droplet endpoint with the pre-shared key.
 *
 * ============================================================================
 * CRITICAL UNSOLVED PIECE (see native/HANDOFF.md, section "The tun fd problem"):
 * Upstream glorytun opens its OWN tun device by name (tun0). On unrooted Android
 * you cannot create a named tun; VpnService hands you an already-open fd instead.
 * glorytun MUST be patched to accept an external fd (e.g. a `fd <n>` argument or
 * env var) INSTEAD of calling tun_create(). This service passes the fd; the native
 * side must consume it. That patch is the main engineering task for the next env.
 * ============================================================================
 */
class BondVpnService : VpnService() {

    companion object {
        private const val TAG = "MeshLinkBond"
        private const val CHANNEL_ID = "meshlink_bond"
        private const val NOTIF_ID = 42

        const val ACTION_CONNECT = "com.meshlink.app.CONNECT"
        const val ACTION_DISCONNECT = "com.meshlink.app.DISCONNECT"

        const val EXTRA_HOST = "host"
        const val EXTRA_PORT = "port"
        const val EXTRA_KEY_HEX = "keyHex"

        // tun addressing (client side of the 10.99.0.0/24 tunnel from the droplet)
        const val TUN_ADDRESS = "10.99.0.2"
        const val TUN_PREFIX = 24
        const val TUN_MTU = 1400
    }

    private val running = AtomicBoolean(false)
    private var vpnInterface: ParcelFileDescriptor? = null
    private var glorytunProcess: Process? = null
    private var wifiNetwork: Network? = null
    private var cellNetwork: Network? = null

    private val cm by lazy { getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCONNECT -> {
                stopBond()
                return START_NOT_STICKY
            }
            ACTION_CONNECT -> {
                val host = intent.getStringExtra(EXTRA_HOST) ?: return START_NOT_STICKY
                val port = intent.getIntExtra(EXTRA_PORT, 5000)
                val keyHex = intent.getStringExtra(EXTRA_KEY_HEX) ?: return START_NOT_STICKY
                startBond(host, port, keyHex)
            }
        }
        return START_STICKY
    }

    private fun startBond(host: String, port: Int, keyHex: String) {
        if (running.getAndSet(true)) {
            Log.w(TAG, "Bond already running")
            return
        }
        startForeground(NOTIF_ID, buildNotification("Bonding to $host:$port"))

        // 1. Acquire BOTH radios so cellular stays alive while Wi-Fi is up.
        acquireRadios()

        // 2. Build the tun interface. addDisallowedApplication(self) prevents a
        //    routing loop where glorytun's own UDP packets re-enter the tunnel.
        val builder = Builder()
            .setSession("MeshLink")
            .setMtu(TUN_MTU)
            .addAddress(TUN_ADDRESS, TUN_PREFIX)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("1.1.1.1")
            .addDnsServer("8.8.8.8")
        try {
            builder.addDisallowedApplication(packageName)
        } catch (e: Exception) {
            Log.e(TAG, "addDisallowedApplication failed", e)
        }

        val iface = builder.establish()
        if (iface == null) {
            Log.e(TAG, "establish() returned null - VPN permission not granted?")
            stopBond()
            return
        }
        vpnInterface = iface
        val tunFd = iface.fd
        Log.i(TAG, "tun established, fd=$tunFd")

        // 3. Launch glorytun with the tun fd. See HANDOFF.md - this arg form
        //    ("fd <n>") requires the glorytun patch to consume an external fd.
        launchGlorytun(host, port, keyHex, tunFd)
    }

    /**
     * Requests Wi-Fi and Cellular concurrently. Holding both callbacks keeps the
     * cellular radio powered even when Wi-Fi is the default network. The bound
     * Network handles are what a full bonding implementation uses to split/steer
     * per-link sockets (the next-stage work).
     */
    private fun acquireRadios() {
        val wifiReq = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        cm.requestNetwork(wifiReq, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                wifiNetwork = network
                Log.i(TAG, "Wi-Fi network available: $network")
            }
            override fun onLost(network: Network) {
                if (wifiNetwork == network) wifiNetwork = null
                Log.w(TAG, "Wi-Fi lost")
            }
        })

        val cellReq = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .build()
        cm.requestNetwork(cellReq, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                cellNetwork = network
                Log.i(TAG, "Cellular network available: $network")
            }
            override fun onLost(network: Network) {
                if (cellNetwork == network) cellNetwork = null
                Log.w(TAG, "Cellular lost")
            }
        })
    }

    private fun launchGlorytun(host: String, port: Int, keyHex: String, tunFd: Int) {
        // The binary is bundled as a .so inside jniLibs so Android extracts it to
        // an executable nativeLibraryDir (the standard unrooted-exec workaround).
        val binary = File(applicationInfo.nativeLibraryDir, "libglorytun.so")
        if (!binary.exists()) {
            Log.e(TAG, "glorytun binary not found at ${binary.absolutePath}")
            stopBond()
            return
        }

        // Write key to a private file glorytun can read.
        val keyFile = File(filesDir, "glorytun.key").apply {
            writeText(keyHex)
            setReadable(true, true)
        }

        // NOTE: "fd $tunFd" is the PATCHED argument form. Upstream glorytun does not
        // accept this yet. See HANDOFF.md.
        val cmd = listOf(
            binary.absolutePath,
            "bind",
            "fd", tunFd.toString(),
            "to", host, port.toString(),
            "keyfile", keyFile.absolutePath,
            "persist"
        )
        Log.i(TAG, "exec: ${cmd.joinToString(" ")}")

        try {
            glorytunProcess = ProcessBuilder(cmd)
                .redirectErrorStream(true)
                .start()

            Thread {
                glorytunProcess?.inputStream?.bufferedReader()?.forEachLine {
                    Log.i(TAG, "[glorytun] $it")
                }
            }.start()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch glorytun", e)
            stopBond()
        }
    }

    private fun stopBond() {
        running.set(false)
        try { glorytunProcess?.destroy() } catch (_: Exception) {}
        glorytunProcess = null
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Log.i(TAG, "Bond stopped")
    }

    override fun onDestroy() {
        stopBond()
        super.onDestroy()
    }

    private fun buildNotification(text: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "MeshLink Bond", NotificationManager.IMPORTANCE_LOW
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("MeshLink")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }
}
