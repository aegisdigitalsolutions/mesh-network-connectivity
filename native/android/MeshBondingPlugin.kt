package com.meshlink.app.bond

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor bridge that the web app (lib/mesh-client.ts -> NativeMeshClient) calls.
 * It implements the exact NativeBonding contract:
 *   window.MeshBonding.connect({ host, port, key })
 *   window.MeshBonding.disconnect()
 *   window.MeshBonding.getTelemetry()
 *
 * When this plugin is present, mesh-client.ts automatically switches from the
 * simulated client to the native one. No web code changes are required.
 */
@CapacitorPlugin(name = "MeshBonding")
class MeshBondingPlugin : Plugin() {

    private var pendingCall: PluginCall? = null

    @PluginMethod
    fun connect(call: PluginCall) {
        val host = call.getString("host")
        val port = call.getInt("port", 5000)!!
        val key = call.getString("key")
        if (host.isNullOrBlank() || key.isNullOrBlank()) {
            call.reject("host and key are required")
            return
        }

        // Android requires user consent for VpnService on first use.
        val prepare = VpnService.prepare(context)
        if (prepare != null) {
            pendingCall = call
            call.setKeepAlive(true)
            // 0x1001 is an arbitrary request code handled in handleOnActivityResult.
            startActivityForResult(call, prepare, "onVpnPermission")
            return
        }
        launchService(host, port, key, call)
    }

    private fun launchService(host: String, port: Int, key: String, call: PluginCall) {
        val intent = Intent(context, BondVpnService::class.java).apply {
            action = BondVpnService.ACTION_CONNECT
            putExtra(BondVpnService.EXTRA_HOST, host)
            putExtra(BondVpnService.EXTRA_PORT, port)
            putExtra(BondVpnService.EXTRA_KEY_HEX, key)
        }
        context.startForegroundService(intent)
        val result = JSObject().apply { put("state", "connecting") }
        call.resolve(result)
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val intent = Intent(context, BondVpnService::class.java).apply {
            action = BondVpnService.ACTION_DISCONNECT
        }
        context.startService(intent)
        call.resolve(JSObject().apply { put("state", "disconnected") })
    }

    /**
     * Telemetry hook. Right now returns a placeholder; the next-stage native code
     * should parse `glorytun path` / `glorytun show` output (per-link bytes, RTT)
     * and return real numbers matching the LinkTelemetry shape in lib/mesh-data.ts.
     */
    @PluginMethod
    fun getTelemetry(call: PluginCall) {
        val result = JSObject().apply {
            put("connected", true)
            put("note", "wire glorytun path/show parsing here - see HANDOFF.md")
        }
        call.resolve(result)
    }

    // Capacitor callback for the VpnService consent dialog result.
    @Suppress("unused")
    fun onVpnPermission(call: PluginCall, result: androidx.activity.result.ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            val host = call.getString("host")!!
            val port = call.getInt("port", 5000)!!
            val key = call.getString("key")!!
            launchService(host, port, key, call)
        } else {
            call.reject("VPN permission denied by user")
        }
    }
}
