# MeshLink — Stage 2 Native Bonding Handoff

This document is written for an engineer or a high-capability AI working in a
full Android/Linux development environment (Android Studio, NDK, a rooted or
test device). It explains exactly what exists, what works, what does **not** yet
work, and the precise tasks required to make "Connect" perform real connection
bonding. Bring the finished result back into this repo and the cloud build
(`.github/workflows/build-apk.yml`) will package it.

---

## 1. System overview (what this product is)

```
  Wi-Fi (M7 / T-Mobile) ─┐
  Cellular (phone SIM) ───┤→ [Android phone: VpnService tun] → glorytun UDP
                          │        multipath tunnel
                          ▼
              [DigitalOcean droplet 159.203.67.127:5000]
              glorytun server (LIVE, reboot-proof) → Internet
                          ▲
   Peer devices (Wi-Fi hotspot / BT PAN) share the bonded pipe (Stage 3)
```

- **Server:** already provisioned and running. glorytun `bind` on `0.0.0.0:5000`,
  cipher `aegis256`, tun `10.99.0.1/24`, NAT masquerade out `eth0`, systemd unit
  `glorytun.service`. Client connects with `to 159.203.67.127 5000` + shared key.
- **Web UI:** Next.js static export wrapped by Capacitor. Runs today in
  **simulation mode**. It talks to the engine ONLY through the `MeshClient`
  interface in `lib/mesh-client.ts`, so the native engine is a drop-in swap.
- **Cloud build:** GitHub Actions compiles the APK with no local machine. Any
  new native files added here are picked up automatically.

---

## 2. What already works (do not redo)

1. **Server side** — complete and verified.
2. **Web dashboard** — complete; installs and runs on the S26 Ultra.
3. **Cloud APK pipeline** — green. Web build → Capacitor → Gradle → signed APK.
   - Kotlin stdlib conflict fixed via `resolutionStrategy` (see workflow).
   - Java 21, npm (not pnpm/corepack), `--legacy-peer-deps`.
4. **Native scaffolding (this `native/` folder)** — written, structurally
   correct, but NOT yet wired into the Android project or functional. See §4.

---

## 3. The core unsolved problem — READ FIRST

**The tun file-descriptor handoff.**

Upstream glorytun opens its own tun device (`tun_create()` → `/dev/net/tun` +
`TUNSETIFF`). On **unrooted Android this is forbidden.** Only `VpnService` can
create a tun, and it returns an already-open **fd**.

Therefore glorytun MUST be patched to accept an external fd instead of creating
its own. This is the linchpin. Everything else is plumbing around it.

- Patch spec + location: `native/patches/README.md`
- `BondVpnService.kt` already passes `fd <tunFd>` on the glorytun command line.
- `native/scripts/build-glorytun-android.sh` auto-applies
  `native/patches/glorytun-android-fd.patch` if present.

**Task A (highest priority):** write `glorytun-android-fd.patch` implementing the
external-fd path in `src/tun.c` / `src/bind.c`, commit it to `native/patches/`.

Alternatives if patching glorytun proves impractical:
- Use a userspace tunnel that already accepts an fd (e.g. build on top of
  `tun2socks`/`wireguard-go` fd support) and keep glorytun only on the server.
- Fork glorytun's `mud` library to expose an fd-injection entry point.

---

## 4. Files in this package and where they go

| File | Destination in generated Android project | Status |
|---|---|---|
| `android/BondVpnService.kt` | `android/app/src/main/java/com/meshlink/app/bond/` | written, needs fd patch to function |
| `android/MeshBondingPlugin.kt` | same package dir | written, needs contract alignment (§5) |
| `android/AndroidManifest.additions.xml` | merge into `android/app/src/main/AndroidManifest.xml` | ready |
| `scripts/build-glorytun-android.sh` | run in CI after `cap add android` | ready, needs patch to produce working binary |
| `patches/glorytun-android-fd.patch` | applied by the build script | **MISSING — Task A** |

The app id is `com.meshlink.app` (see `capacitor.config.ts`). Keep the package
path in sync.

---

## 5. Web ↔ native contract MISMATCH — must reconcile

The web side (`lib/mesh-client.ts`, interface `NativeBonding`) expects the
injected `window.MeshBonding` to expose:

```ts
connect(opts: { host: string; port: number; key: string }): Promise<void>
disconnect(): Promise<void>
getSnapshot(): MeshSnapshot          // SYNCHRONOUS
getState(): ConnectionState          // SYNCHRONOUS
setUplinkEnabled(opts: { id: string; enabled: boolean }): void
```

The Kotlin plugin (`MeshBondingPlugin.kt`) currently exposes `connect`,
`disconnect`, `getTelemetry`. Two things to fix:

1. **Method parity:** implement `getSnapshot`, `getState`, `setUplinkEnabled`
   (rename/replace `getTelemetry`).
2. **Sync vs async:** Capacitor bridge methods are Promise-based; the web contract
   calls `getSnapshot()`/`getState()` synchronously in a render/poll loop. Choose one:
   - (Recommended) Add a thin JS adapter that caches the latest snapshot pushed
     from native via `notifyListeners`, so the sync getters read from cache; OR
   - Change `mesh-client.ts` `NativeMeshClient.poll()`/`getState()` to be async and
     update the dashboard's poll loop accordingly.

`MeshSnapshot` / `Uplink` / `LinkTelemetry` shapes are defined in
`lib/mesh-data.ts` — the native `getSnapshot` must return that exact JSON shape so
the existing UI renders real data with zero UI changes.

---

## 6. Real bonding logic (the actual multipath work)

`BondVpnService.kt` acquires Wi-Fi + cellular via
`ConnectivityManager.requestNetwork()` and keeps both callbacks alive (this is
what keeps cellular powered alongside Wi-Fi). What remains:

- **Per-link steering:** glorytun's `mud` layer does the multipath scheduling on
  UDP sockets. For it to use BOTH radios, its outbound UDP sockets must be bound
  to specific `Network` objects via `Network.bindSocket(fd)`. Options:
  - Patch glorytun to expose its socket fds so the service can `bindSocket` them; or
  - Run two glorytun `path`s and bind each to a different `Network`.
- **`glorytun path`** management: add paths for each active radio and remove them
  on `onLost`. Parse `glorytun show` / `glorytun path status` for per-link RTT and
  byte counters to feed `getSnapshot`.
- **Reconnect/failover:** on radio loss, glorytun already fails over if a second
  path is up. Verify seamless behavior on real link drop.

---

## 7. Build & test loop (in the target environment)

1. `npm install --legacy-peer-deps && CAPACITOR_BUILD=1 npm run build`
2. `npx cap add android && npx cap sync android`
3. Copy the `native/android/*.kt` into the package dir; merge the manifest.
4. Register the plugin (Capacitor 6/7 auto-discovers `@CapacitorPlugin` in the
   app module; confirm it appears in `MainActivity` or `capacitor.plugins.json`).
5. Run `native/scripts/build-glorytun-android.sh` (needs `ANDROID_NDK_HOME`).
6. `cd android && ./gradlew assembleDebug`
7. Install on the S26 Ultra, tap Connect, grant the VPN consent dialog.
8. **Verify:** on the droplet run `glorytun show` — a client path should appear.
   On the phone, `https://ifconfig.me` should return `159.203.67.127`.

Server-side sanity while testing: `systemctl status glorytun`, `glorytun show`.

---

## 8. Definition of done for Stage 2

- Tapping **Connect** establishes the VpnService tun and a glorytun path to the
  droplet; `glorytun show` on the server lists the phone; phone's public IP is the
  droplet's.
- Both Wi-Fi and cellular are held simultaneously; pulling one does not drop the
  session (failover).
- `getSnapshot` returns real per-link throughput/RTT; the existing dashboard shows
  live bonded numbers instead of simulation.

## 9. Stage 3 (later, not now)

Share the bonded pipe to peer devices: SoftAP (STA+AP concurrency on the S26) +
on-device SOCKS/HTTP proxy or NAT, and Bluetooth PAN (NAP). Permissions are
already declared in the manifest additions.

---

## 10. Ground truth / constants

- Droplet: `159.203.67.127`, UDP `5000`, cipher `aegis256`
- Tunnel subnet: `10.99.0.0/24` (server `.1`, client `.2`)
- Key: from `/etc/glorytun.key` on the droplet (user pastes it into the app)
- App id: `com.meshlink.app`; web dir: `out/`
- iOS is NOT in scope for real bonding (Apple blocks per-packet dual-radio); this
  handoff is Android-only.
