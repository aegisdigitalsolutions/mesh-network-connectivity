package com.meshlink.app.bond

import android.app.*
import android.content.Context
import android.content.Intent
import android.net.*
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.getcapacitor.JSObject
import java.io.File
import java.io.FileDescriptor
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class BondVpnService : VpnService() {

    companion object {
        private const val TAG = "MeshLinkBond"
        private const val NOTIF_CHANNEL = "meshlink_bond"
        private const val NOTIF_ID = 1001
        private const val FD_HELPER_NAME = "meshlink-fd-helper"

        // How long to wait for a real tunnel path before giving up. A full-tunnel
        // VPN with no reachable server blackholes ALL traffic, so we must bail out
        // and tear down instead of spinning forever.
        private const val CONNECT_TIMEOUT_MS = 20_000L
        private const val WATCHDOG_POLL_MS = 1_000L

        @Volatile var state: String = "disconnected"; private set
        @Volatile var lastError: String? = null; private set
        private val snapshotRef = AtomicReference(JSObject())
        var snapshotListener: ((JSObject) -> Unit)? = null

        fun latestSnapshotJson(): JSObject = snapshotRef.get()

        private val disabledUplinks = mutableSetOf<String>()
        fun setUplinkEnabled(id: String, enabled: Boolean) {
            synchronized(disabledUplinks) {
                if (enabled) disabledUplinks.remove(id) else disabledUplinks.add(id)
            }
        }
    }

    private var tunPfd: ParcelFileDescriptor? = null
    private var glorytun: Process? = null
    private var fdHelperThread: Thread? = null
    private var fdHelperServer: android.net.LocalServerSocket? = null
    private var telemetryThread: Thread? = null
    @Volatile private var running = false

    private var wifiNetwork: Network? = null
    private var cellNetwork: Network? = null
    private var wifiCallback: ConnectivityManager.NetworkCallback? = null
    private var cellCallback: ConnectivityManager.NetworkCallback? = null

    // ------------------------------------------------------------ lifecycle

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { teardown(); stopSelf(); return START_NOT_STICKY }

        val host = intent?.getStringExtra("host") ?: return START_NOT_STICKY
        val port = intent.getIntExtra("port", 5000)
        val key  = intent.getStringExtra("key") ?: return START_NOT_STICKY
        val accelerator = intent.getBooleanExtra("accelerator", true)

        startForeground(NOTIF_ID, buildNotification("Connecting…"))
        state = "connecting"
        lastError = null
        pushSnapshot()

        thread(name = "meshlink-connect") {
            try {
                acquireNetworks()
                startFdHelper()
                establishAndLaunch(host, port, key, accelerator)

                // Do NOT report "connected" yet — glorytun has launched but no
                // path to the server exists. Wait for a real tunnel before we
                // let the UI (and the user) believe traffic is flowing.
                if (awaitTunnel()) {
                    startTelemetry()
                    state = "connected"
                    updateNotification("Bonded tunnel active")
                } else {
                    Log.e(TAG, "no tunnel within ${CONNECT_TIMEOUT_MS}ms — tearing down")
                    lastError = "Couldn't reach server $host:$port. Check the server is running and UDP $port is open."
                    teardown()          // restores normal connectivity (sets disconnected)
                    state = "error"     // ...then land on error so the UI shows why
                    stopSelf()
                }
            } catch (e: Exception) {
                Log.e(TAG, "connect failed", e)
                lastError = e.message ?: "Connection failed"
                teardown()
                state = "error"
                stopSelf()
            }
            pushSnapshot()
        }
        return START_STICKY
    }

    /**
     * Polls glorytun until a real tunnel path is established or the timeout
     * elapses. Returns true only when the tunnel is actually usable. This is the
     * safety-net that prevents a full-tunnel VPN from blackholing the device
     * forever when the server is unreachable (e.g. blocked UDP port).
     */
    private fun awaitTunnel(): Boolean {
        val deadline = System.currentTimeMillis() + CONNECT_TIMEOUT_MS
        while (running && System.currentTimeMillis() < deadline) {
            if (tunnelEstablished(runCtl("show") ?: "")) {
                Log.i(TAG, "tunnel established")
                return true
            }
            try { Thread.sleep(WATCHDOG_POLL_MS) } catch (_: InterruptedException) { return false }
        }
        return false
    }

    /**
     * A tunnel is considered up once glorytun negotiates with the peer. Before
     * the handshake the peer/MTU are unset (remote 0.0.0.0, mtu 0); after it,
     * the MTU is populated and/or bytes have moved. We accept several signals so
     * we're not brittle against glorytun's exact `show` formatting.
     */
    private fun tunnelEstablished(show: String): Boolean {
        if (show.isBlank()) return false
        for (raw in show.lineSequence()) {
            val line = raw.trim()
            when {
                // A real, negotiated MTU (was 0 while idle).
                line.startsWith("mtu") -> {
                    val v = line.split(Regex("\\s+")).getOrNull(1)?.toIntOrNull() ?: 0
                    if (v > 0) return true
                }
                // A remote that isn't the unset placeholder.
                line.startsWith("remote") &&
                    !line.contains("0.0.0.0") && Regex("\\d+\\.\\d+\\.\\d+\\.\\d+").containsMatchIn(line) -> return true
                // An explicitly up/OK path row.
                Regex("\\b(up|ok)\\b", RegexOption.IGNORE_CASE).containsMatchIn(line) &&
                    Regex("\\d+\\.\\d+\\.\\d+\\.\\d+").containsMatchIn(line) -> return true
            }
        }
        return false
    }

    override fun onRevoke() { teardown(); stopSelf() }
    override fun onDestroy() { teardown(); super.onDestroy() }

    // ------------------------------------------------------------ networks

    private fun acquireNetworks() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        fun request(transport: Int, onChange: (Network?) -> Unit): ConnectivityManager.NetworkCallback {
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(n: Network) { onChange(n); onRadioChanged() }
                override fun onLost(n: Network)      { onChange(null); onRadioChanged() }
            }
            cm.requestNetwork(
                NetworkRequest.Builder()
                    .addTransportType(transport)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(), cb)
            return cb
        }
        // Holding both requests keeps cellular powered alongside Wi-Fi.
        wifiCallback = request(NetworkCapabilities.TRANSPORT_WIFI)     { wifiNetwork = it }
        cellCallback = request(NetworkCapabilities.TRANSPORT_CELLULAR) { cellNetwork = it }
    }

    private fun onRadioChanged() {
        if (!running) return
        thread { runCtl("path")?.let { Log.d(TAG, "paths: $it") } }
    }

    // ------------------------------------------------------------ fd helper

    /** Receives glorytun's UDP socket fds via SCM_RIGHTS; protects and binds them. */
    private fun startFdHelper() {
        // If a prior attempt left this named socket bound (abstract namespace),
        // creating it again throws "Address already in use". Close any stale one
        // first so retries never collide.
        try { fdHelperServer?.close() } catch (_: Exception) {}
        val server = android.net.LocalServerSocket(FD_HELPER_NAME)
        fdHelperServer = server
        fdHelperThread = thread(name = "meshlink-fd-helper") {
            try {
                while (running || glorytun == null) {
                    val client = server.accept()
                    try {
                        val buf = ByteArray(128)
                        val n = client.inputStream.read(buf)
                        val tag = if (n > 0) String(buf, 0, n) else "default"
                        val fds: Array<FileDescriptor>? = client.ancillaryFileDescriptors
                        if (fds != null) for (fd in fds) handleTunnelSocket(fd, tag)
                        client.outputStream.write(1)   // ack — unblocks glorytun
                        client.outputStream.flush()
                    } finally { client.close() }
                }
            } catch (_: Exception) { /* socket closed on teardown */ }
            finally { try { server.close() } catch (_: Exception) {} }
        }
    }

    private fun handleTunnelSocket(fd: FileDescriptor, tag: String) {
        // 1) MANDATORY: without protect() tunnel packets loop into our own tun.
        val intFd = fdToInt(fd)
        if (!protect(intFd)) Log.e(TAG, "protect() FAILED for $tag — routing loop risk")

        // 2) Steer onto the right radio (fwmark). One socket = one network.
        val net = when {
            tag.startsWith("cell") || cellOwns(tag) -> cellNetwork
            tag == "default" -> null                 // Gate 1: default network
            else -> wifiNetwork
        }
        try { net?.bindSocket(fd) } catch (e: Exception) {
            Log.w(TAG, "bindSocket($tag) failed: ${e.message}") // non-fatal
        }
        Log.d(TAG, "tunnel socket $intFd tag=$tag bound=${net != null}")
    }

    private fun cellOwns(tag: String): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cellNetwork ?: return false
        val lp = cm.getLinkProperties(net) ?: return false
        return lp.linkAddresses.any { tag.contains(it.address.hostAddress ?: "\u0000") }
    }

    private fun fdToInt(fd: FileDescriptor): Int {
        val f = FileDescriptor::class.java.getDeclaredField("descriptor")
        f.isAccessible = true
        return f.getInt(fd)
    }

    // ------------------------------------------------------------ tunnel

    private fun establishAndLaunch(host: String, port: Int, key: String, accelerator: Boolean) {
        // Accelerator ON: a larger tunnel MTU (1400) matched to the server-side
        // TCP MSS clamp in accelerator-tune.sh — fewer packets, higher throughput.
        // OFF: a conservative 1280 that traverses any path but carries more
        // per-packet overhead. This is a glorytun-safe knob (the tun's own MTU),
        // so we never risk feeding glorytun an unrecognized CLI flag.
        val mtu = if (accelerator) 1400 else 1280
        Log.i(TAG, "establish: accelerator=$accelerator mtu=$mtu")

        val builder = Builder()
            .setSession("MeshLink")
            .addAddress("10.99.0.2", 24)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("1.1.1.1")
            .addDnsServer("9.9.9.9")
            .setMtu(mtu)
            .allowBypass()

        // Gate 1 loop-prevention: the glorytun subprocess runs under our own UID.
        // Excluding our package keeps its UDP tunnel packets OUT of the tun we just
        // created (otherwise they'd recurse). This is what makes bonding work with
        // vanilla mud; the Gate 2 fd-helper/protect() path supersedes this later.
        try {
            builder.addDisallowedApplication(packageName)
        } catch (e: Exception) {
            Log.w(TAG, "addDisallowedApplication failed: ${e.message}")
        }

        val pfd = builder.establish()
            ?: throw IllegalStateException("establish() null — consent missing?")
        tunPfd = pfd

        val keyFile = File(filesDir, "gt.key").apply {
            writeText(key.trim() + "\n")
            setReadable(false, false); setReadable(true, true)
        }

        val bin = File(applicationInfo.nativeLibraryDir, "libglorytun.so")
        if (!bin.exists()) throw IllegalStateException("libglorytun.so missing from nativeLibraryDir")

        val tunFd = pfd.detachFd()   // ownership -> glorytun. Never touch pfd.fd after.
        running = true

        val pb = ProcessBuilder(
            bin.absolutePath, "bind", "0.0.0.0",
            "dev", "tun-vpn",
            "keyfile", keyFile.absolutePath,
            "to", host, port.toString(),
            "retry", "count", "-1", "const", "1000000"   // reconnect forever, 1s
        ).redirectErrorStream(true)
        pb.environment()["GT_TUN_FD"]    = tunFd.toString()
        pb.environment()["GT_RUNDIR"]    = filesDir.absolutePath
        pb.environment()["GT_FD_HELPER"] = FD_HELPER_NAME

        glorytun = pb.start()

        thread(name = "meshlink-gt-log") {
            glorytun?.inputStream?.bufferedReader()?.forEachLine { Log.i(TAG, "gt: $it") }
            if (running) {
                Log.e(TAG, "glorytun exited unexpectedly")
                state = "error"; pushSnapshot(); teardown(); stopSelf()
            }
        }
    }

    // ------------------------------------------------------------ telemetry

    /** Invokes the same binary as a ctl client against GT_RUNDIR. */
    private fun runCtl(vararg args: String): String? = try {
        val bin = File(applicationInfo.nativeLibraryDir, "libglorytun.so").absolutePath
        val pb = ProcessBuilder(listOf(bin) + args).redirectErrorStream(true)
        pb.environment()["GT_RUNDIR"] = filesDir.absolutePath
        val p = pb.start()
        val out = p.inputStream.bufferedReader().readText()
        p.waitFor(); out
    } catch (e: Exception) { Log.w(TAG, "ctl ${args.joinToString(" ")}: ${e.message}"); null }

    private fun startTelemetry() {
        telemetryThread = thread(name = "meshlink-telemetry") {
            var prevWifiBytes = 0L; var prevCellBytes = 0L
            while (running) {
                try {
                    val show = runCtl("show") ?: ""
                    // Shape MUST match the native-adapter mapping in lib/native-adapter.ts.
                    val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                    val uplinks = com.getcapacitor.JSArray()

                    fun uplink(id: String, name: String, net: Network?, type: String,
                               prev: Long, setPrev: (Long) -> Unit) {
                        val up = net != null
                        val (rtt, bytes) = parsePathStats(show, net, cm)
                        val throughputMbps = ((bytes - prev).coerceAtLeast(0) * 8) / 1_000_000.0
                        setPrev(bytes)
                        val enabled = synchronized(disabledUplinks) { id !in disabledUplinks }
                        uplinks.put(JSObject().apply {
                            put("id", id); put("name", name); put("type", type)
                            put("status", if (!enabled) "disabled" else if (up) "active" else "down")
                            put("enabled", enabled)
                            put("telemetry", JSObject().apply {
                                put("throughputMbps", throughputMbps)
                                put("latencyMs", rtt)
                                put("bytesTransferred", bytes)
                            })
                        })
                    }
                    uplink("wifi", "Wi-Fi (M7)", wifiNetwork, "wifi", prevWifiBytes) { prevWifiBytes = it }
                    uplink("cell", "Cellular",  cellNetwork, "cellular", prevCellBytes) { prevCellBytes = it }

                    val snap = JSObject().apply {
                        put("state", state)
                        put("uplinks", uplinks)
                        put("serverHost", "159.203.67.127")
                        put("timestamp", System.currentTimeMillis())
                        lastError?.let { put("error", it) }
                    }
                    snapshotRef.set(snap)
                    snapshotListener?.invoke(snap)
                } catch (e: Exception) { Log.w(TAG, "telemetry: ${e.message}") }
                Thread.sleep(1000)
            }
        }
    }

    /** Parse `glorytun show` for the path matching this network's local addr. */
    private fun parsePathStats(show: String, net: Network?, cm: ConnectivityManager): Pair<Double, Long> {
        if (net == null) return 0.0 to 0L
        val addrs = cm.getLinkProperties(net)?.linkAddresses
            ?.mapNotNull { it.address.hostAddress } ?: return 0.0 to 0L
        val line = show.lineSequence().firstOrNull { l -> addrs.any { l.contains(it) } }
            ?: return 0.0 to 0L
        // glorytun show columns: local remote state rtt(us) rate tx rx ...
        val cols = line.trim().split(Regex("\\s+"))
        val rttMs = cols.getOrNull(3)?.toDoubleOrNull()?.div(1000.0) ?: 0.0
        val bytes = (cols.getOrNull(5)?.toLongOrNull() ?: 0L) + (cols.getOrNull(6)?.toLongOrNull() ?: 0L)
        return rttMs to bytes
    }

    private fun pushSnapshot() {
        val snap = snapshotRef.get().apply {
            put("state", state)
            lastError?.let { put("error", it) }
        }
        snapshotRef.set(snap); snapshotListener?.invoke(snap)
    }

    // ------------------------------------------------------------ teardown

    private fun teardown() {
        running = false
        state = "disconnected"
        try { glorytun?.destroy() } catch (_: Exception) {}
        glorytun = null
        // Close the fd-helper socket so its accept() thread unblocks and releases
        // the "meshlink-fd-helper" name — otherwise the NEXT connect attempt dies
        // with "Address already in use".
        try { fdHelperServer?.close() } catch (_: Exception) {}
        fdHelperServer = null
        try { fdHelperThread?.interrupt() } catch (_: Exception) {}
        fdHelperThread = null
        try { tunPfd?.close() } catch (_: Exception) {}   // no-op if detached
        tunPfd = null
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        wifiCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
        cellCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
        wifiCallback = null; cellCallback = null; wifiNetwork = null; cellNetwork = null
        pushSnapshot()
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    // ------------------------------------------------------------ notification

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26)
            nm.createNotificationChannel(NotificationChannel(
                NOTIF_CHANNEL, "MeshLink Bonding", NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle("MeshLink").setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true).build()
    }
    private fun updateNotification(text: String) =
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(text))
}
