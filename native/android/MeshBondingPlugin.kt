package com.meshlink.app.bond

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import androidx.activity.result.ActivityResult
import com.getcapacitor.*
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "MeshBonding")
class MeshBondingPlugin : Plugin() {

    override fun load() {
        BondVpnService.snapshotListener = { snap -> notifyListeners("meshSnapshot", snap) }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val prep = VpnService.prepare(activity)
        if (prep != null) startActivityForResult(call, prep, "vpnConsentResult")
        else startBond(call)
    }

    @ActivityCallback
    private fun vpnConsentResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) startBond(call)
        else call.reject("VPN consent denied by user")
    }

    private fun startBond(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("host required")
        val key  = call.getString("key")  ?: return call.reject("key required")
        val i = Intent(context, BondVpnService::class.java).apply {
      putExtra("host", host)
      putExtra("port", call.getInt("port") ?: 5000)
      putExtra("key", key)
      putExtra("accelerator", call.getBoolean("accelerator") ?: true)
    }
        context.startForegroundService(i)
        call.resolve()
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        context.startService(Intent(context, BondVpnService::class.java).setAction("STOP"))
        call.resolve()
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) = call.resolve(BondVpnService.latestSnapshotJson())

    @PluginMethod
    fun getState(call: PluginCall) =
        call.resolve(JSObject().put("state", BondVpnService.state))

    @PluginMethod
    fun setUplinkEnabled(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val enabled = call.getBoolean("enabled") ?: return call.reject("enabled required")
        BondVpnService.setUplinkEnabled(id, enabled)
        call.resolve()
    }
}
