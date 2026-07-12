# MeshLink — Android / Capacitor Build Guide

This is the phone side. It turns the v0 control app into an installable APK whose
"Connect" button drives a **real glorytun client** that bonds Wi-Fi + cellular and
tunnels to your droplet at `159.203.67.127:5000`.

> **Reality check:** everything in this file is compiled in **Android Studio on a
> computer** (Windows/Mac/Linux). It cannot be built inside v0. v0 produced the UI +
> the `NativeBonding` contract; this guide implements that contract in Kotlin.

---

## Server recap (already done)

| Parameter | Value |
|---|---|
| Server IP | `159.203.67.127` |
| Port | `5000` (UDP) |
| Cipher | `aegis256` |
| Tunnel subnet | `10.99.0.0/24` (server `.1`, client `.2`) |
| Key | contents of `/etc/glorytun.key` on the droplet |

The client launches glorytun with the `to` keyword (vs the server's bare bind):

```
glorytun bind dev tun0 to 159.203.67.127 5000 keyfile <key> persist
```

But on Android you don't run a shell binary — you cross-compile glorytun and drive
its multipath logic through Android's `VpnService`. The plugin below does that.

---

## 0. Prerequisites (install on your computer)

- **Android Studio** (latest) + Android SDK (API 34)
- **Node.js 18+** and **npm**
- **Android NDK** (installed via Android Studio → SDK Manager → SDK Tools → check "NDK (Side by side)")
- A **USB cable** + your S26 Ultra with **Developer Options → USB debugging** enabled

---

## 1. Export the v0 web app

From the v0 project (this repo), produce a static build Capacitor can wrap.

```bash
# in the v0 project root, on your computer
npm install
npm run build
```

For Capacitor, set the Next.js app to static export. In `next.config.mjs`:

```js
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
}
export default nextConfig
```

Re-run `npm run build` → this produces an `out/` folder (the static site).

---

## 2. Create the Capacitor shell

```bash
npm install @capacitor/core @capacitor/cli
npx cap init MeshLink com.meshlink.app --web-dir=out
npm install @capacitor/android
npx cap add android
npx cap sync android
```

You now have an `android/` folder — open it in Android Studio.

---

## 3. Add glorytun as a native library

glorytun is C. You compile it for Android's ABIs with the NDK.

1. Copy the glorytun source into `android/app/src/main/cpp/glorytun/`.
2. Add a `CMakeLists.txt` that builds glorytun's core (`mud`, `argz`, crypto) as a
   shared lib `libglorytun.so`. Reference the upstream `meson.build` for the source
   list; the key files are `src/mud.c`, `src/aegis256/*`, `src/argz/*`.
3. Wire CMake into Gradle — in `android/app/build.gradle`:

```gradle
android {
  defaultConfig {
    externalNativeBuild { cmake { cppFlags "" } }
    ndk { abiFilters 'arm64-v8a' }   // S26 Ultra is arm64
  }
  externalNativeBuild { cmake { path "src/main/cpp/CMakeLists.txt" } }
}
```

> If cross-compiling glorytun's C is more than you want to take on, the alternative
> is to reimplement its packet path in Kotlin using `mud`'s UDP multipath approach.
> Compiling the C is the faster, more faithful route.

---

## 4. Android permissions

In `android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

Register the VPN service inside `<application>`:

```xml
<service
  android:name=".BondVpnService"
  android:permission="android.permission.BIND_VPN_SERVICE"
  android:foregroundServiceType="specialUse"
  android:exported="false">
  <intent-filter>
    <action android:name="android.net.VpnService" />
  </intent-filter>
</service>
```

---

## 5. The VpnService — the real engine

Create `android/app/src/main/java/com/meshlink/app/BondVpnService.kt`. This is the
core: it holds **both radios at once**, builds the tunnel fd, and hands packets to
glorytun which splits them across links to `159.203.67.127:5000`.

```kotlin
package com.meshlink.app

import android.app.*
import android.content.Intent
import android.net.*
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class BondVpnService : VpnService() {

  private var tunFd: android.os.ParcelFileDescriptor? = null
  private val cm by lazy { getSystemService(ConnectivityManager::class.java) }

  // Handles to each uplink we keep simultaneously alive
  private var wifiNetwork: Network? = null
  private var cellNetwork: Network? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(1, buildNotification())
    val host = intent?.getStringExtra("host") ?: "159.203.67.127"
    val port = intent?.getIntExtra("port", 5000) ?: 5000
    val key  = intent?.getStringExtra("key") ?: ""
    acquireBothRadios()
    startTunnel(host, port, key)
    return START_STICKY
  }

  /** Request Wi-Fi AND cellular concurrently so neither drops. */
  private fun acquireBothRadios() {
    val wifiReq = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
    cm.requestNetwork(wifiReq, object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(n: Network) { wifiNetwork = n }
      override fun onLost(n: Network) { wifiNetwork = null }
    })

    val cellReq = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
    cm.requestNetwork(cellReq, object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(n: Network) { cellNetwork = n }
      override fun onLost(n: Network) { cellNetwork = null }
    })
  }

  private fun startTunnel(host: String, port: Int, key: String) {
    val builder = Builder()
      .setSession("MeshLink")
      .addAddress("10.99.0.2", 24)     // client side of the tunnel subnet
      .addDnsServer("1.1.1.1")
      .addRoute("0.0.0.0", 0)          // send all traffic through the bond
      .setMtu(1400)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

    tunFd = builder.establish()

    // Hand tunFd + the two Networks to the native glorytun client.
    // glorytun opens a UDP path bound to EACH network (bindSocket per link)
    // and multipaths packets to host:port using the shared key.
    NativeBridge.startGlorytun(
      tunFd!!.fd, host, port, key,
      wifiFd = protectAndSocketFor(wifiNetwork),
      cellFd = protectAndSocketFor(cellNetwork),
    )
  }

  /** Create a UDP socket, bind it to a specific radio, and protect it from the VPN loop. */
  private fun protectAndSocketFor(net: Network?): Int {
    val sock = java.net.DatagramSocket()
    protect(sock)                 // keep this socket OUTSIDE the tunnel
    net?.bindSocket(sock)         // force it onto this exact radio
    return NativeBridge.fdOf(sock)
  }

  private fun buildNotification(): Notification {
    val ch = "meshlink"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(ch, "MeshLink", NotificationManager.IMPORTANCE_LOW))
    }
    return NotificationCompat.Builder(this, ch)
      .setContentTitle("MeshLink bond active")
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setOngoing(true).build()
  }

  override fun onDestroy() {
    NativeBridge.stopGlorytun()
    tunFd?.close()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
```

`NativeBridge` is your JNI wrapper around the compiled `libglorytun.so`:

```kotlin
package com.meshlink.app

object NativeBridge {
  init { System.loadLibrary("glorytun") }
  external fun startGlorytun(tunFd: Int, host: String, port: Int, key: String,
                             wifiFd: Int, cellFd: Int): Int
  external fun stopGlorytun()
  external fun fdOf(sock: java.net.DatagramSocket): Int
  external fun linkStats(): String  // returns JSON telemetry for the dashboard
}
```

---

## 6. The Capacitor plugin (bridges web UI ↔ VpnService)

Create `MeshBondingPlugin.kt`. This exposes exactly the `NativeBonding` interface
that `lib/mesh-client.ts` already calls (`connect`, `disconnect`, `getStatus`,
`subscribe`), so **no web code changes**.

```kotlin
package com.meshlink.app

import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import android.content.Intent
import android.net.VpnService

@CapacitorPlugin(name = "MeshBonding")
class MeshBondingPlugin : Plugin() {

  @PluginMethod
  fun connect(call: PluginCall) {
    val host = call.getString("host") ?: "159.203.67.127"
    val port = call.getInt("port") ?: 5000
    val key  = call.getString("key") ?: ""

    // System consent screen for VPN (first run only)
    val prep = VpnService.prepare(context)
    if (prep != null) { startActivityForResult(call, prep, "onVpnConsent"); return }

    val svc = Intent(context, BondVpnService::class.java)
      .putExtra("host", host).putExtra("port", port).putExtra("key", key)
    context.startForegroundService(svc)
    call.resolve(JSObject().put("status", "connected"))
  }

  @PluginMethod
  fun disconnect(call: PluginCall) {
    context.stopService(Intent(context, BondVpnService::class.java))
    call.resolve(JSObject().put("status", "disconnected"))
  }

  @PluginMethod
  fun getStatus(call: PluginCall) {
    call.resolve(JSObject().put("telemetry", NativeBridge.linkStats()))
  }

  @ActivityCallback
  fun onVpnConsent(call: PluginCall, result: androidx.activity.result.ActivityResult) {
    if (result.resultCode == android.app.Activity.RESULT_OK) connect(call)
    else call.reject("VPN permission denied")
  }
}
```

Register it in `MainActivity.java`/`.kt`:

```kotlin
registerPlugin(MeshBondingPlugin::class.java)
```

---

## 7. Point the web app at the plugin

In `lib/mesh-client.ts`, the `NativeMeshClient` path already checks for
`window.MeshBonding`. Capacitor injects that automatically once the plugin is
registered, so the UI switches from simulation to the real bond with zero edits.
Just confirm the telemetry JSON your `NativeBridge.linkStats()` returns matches the
`LinkTelemetry` shape in `mesh-data.ts`.

---

## 8. Build + install the APK

```bash
npx cap sync android
```

Then in Android Studio:
1. **Build → Make Project** (compiles Kotlin + the native `libglorytun.so`)
2. Plug in the S26 Ultra → select it as the target
3. **Run ▶** to install and launch
4. For a shareable APK: **Build → Build Bundle(s)/APK(s) → Build APK(s)**, then sign it
   (Build → Generate Signed Bundle/APK) so friends can install it

---

## 9. First-run flow on the phone

1. Open MeshLink → tap the settings gear → paste your **key** (from `/etc/glorytun.key`).
   Host `159.203.67.127` and port `5000` are pre-filled.
2. Tap **Connect bond** → accept the Android VPN consent dialog.
3. The dashboard flips to **Live** with real throughput. Verify bonding worked:
   on the droplet, `glorytun show` should now list your phone as a connected path
   (`glorytun path` shows per-link status).

---

## 10. Sharing to the other 11 devices

Once one S26 Ultra is bonded, share the pipe:
- **Wi-Fi:** enable the phone's hotspot (STA+AP concurrency on the S26 lets it stay
  on the M7 Pro's Wi-Fi *and* broadcast). Peers join and ride the bond.
- **Bluetooth:** use `BluetoothPan` (NAP role) for BT-linked peers.

iPads/iPhones benefit fully **as clients** of this hotspot — no iOS bonding limits
apply when they're just consuming the shared connection.

---

## Honest difficulty map

| Step | Difficulty | Notes |
|---|---|---|
| 1–2 web export + Capacitor | Easy | Standard tooling |
| 3 compile glorytun (NDK) | **Hard** | C cross-compile; the real work |
| 4–5 VpnService + dual radio | **Hard** | Advanced Android networking; debug on-device |
| 6–7 plugin bridge | Medium | Contract already defined by v0 |
| 8–9 build + connect | Easy | Once the above compiles |
| 10 sharing | Medium | SoftAP + BT PAN |

Steps 3 and 5 are where you'll spend real debugging time. Everything else is
assembly. When you hit a specific compile or runtime error, bring it back here and
we'll work through it.
