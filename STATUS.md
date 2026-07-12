# MeshLink — Project Status (single source of truth)

Last updated: 2026-07-12. This file is the honest "where are we" snapshot. Hand
it to anyone (human or AI) so they can see the real state without a Q&A session.

---

## What MeshLink is trying to be

Bond ONE Android phone's two internet paths (its own cellular SIM + Wi-Fi, where
Wi-Fi = a Netgear M7 Pro 5G hotspot) into a single drop-proof tunnel to a VPS,
so a link dying mid-stream doesn't drop the session. Then reshare that bonded
pipe to other devices (iPhones, iPads, Galaxies, laptops) WITHOUT a
battery/data-killing hotspot.

```
  Wi-Fi (M7 / T-Mobile) ─┐
  Cellular (phone SIM) ───┤→ [Android phone: VpnService tun → glorytun UDP] → VPS 159.203.67.127:5000 → Internet
                          │                                                        │
                          ▼                                                        └─► reshare to peer devices (NOT built yet)
```

Ground truth constants:
- Droplet `159.203.67.127`, UDP **5000**, cipher `aegis256`, tunnel subnet `10.99.0.0/24`
- App id `com.meshlink.app`, web export dir `out/`
- Build: GitHub Actions → Kotlin (jvmTarget 17, stdlib 1.8.22) → signed APK
- iOS is NOT in scope for bonding (Apple blocks per-packet dual-radio)

---

## ✅ WORKS TODAY (verified, do not redo)

1. **VPS server** — live and reboot-proof. glorytun on UDP 5000, NAT, systemd unit.
2. **Cloud APK build** — green. Web → Capacitor → Gradle → signed APK, no local machine.
3. **Web dashboard** — installs and runs on the S26 Ultra.
4. **Native engine is detected** — subtitle reads "Native bond · live" (fixed via
   `window.Capacitor.Plugins.MeshBonding`). It creates a real Android VPN profile.
5. **No more preset/fake data** — uplinks & devices populate only from live telemetry.
6. **Connection watchdog + error banner** — Connect no longer spins forever; if no
   tunnel in 20s it tears down, restores connectivity, and shows WHY it failed.
7. **Accelerator** — server tuning script (`accelerator-tune.sh`, BBR + buffers +
   MSS clamp, installs as boot service) + in-app on/off toggle (tunnel MTU 1400/1280).
8. **MeshDrop file/photo sharing** — in-app tab + zero-dependency VPS relay
   (`meshdrop-relay.js`) + installer. All endpoints tested (upload/inbox/download).
9. **Media permissions** — added to the manifest (Android 13+ granular + legacy fallback).

---

## ❌ NOT WORKING YET (the actual gaps)

### GATE 1 — True simultaneous dual-radio bonding  ← THE CORE UNSOLVED PROBLEM
Right now the tunnel rides essentially ONE path, not two aggregated with seamless
failover. Two sub-problems:
- **The glorytun tun-fd patch is MISSING.** Upstream glorytun opens its own tun
  device; unrooted Android forbids that. It must be patched to accept the fd from
  `VpnService.establish()`. This is the linchpin — see `native/patches/README.md`.
- **Per-path radio binding** — each glorytun UDP socket must be bound to a specific
  `Network` (Wi-Fi vs cellular) via `Network.bindSocket()` so both radios stay live.

### GATE 2 — Reshare the bond to other devices (Stage 3)
Not built. Needs an on-device proxy (NetShare/Speedify-style SOCKS/HTTP) or SoftAP
+ NAT, so client devices ride the bonded pipe. Bluetooth PAN is a possible tertiary.

### Firewall dependency (operational, not code)
Connect only reaches the server if **UDP 5000** (bond) and **TCP 8088** (MeshDrop)
are open inbound on the DigitalOcean Cloud Firewall, and outbound is left wide open
(needed so Wi-Fi Calling / VoIP keeps working).

---

## Honest expectations

- This does **NOT** rescue dropped **cellular voice** calls (carrier IMS can't be
  tunneled). The fix for dropped calls is **Wi-Fi Calling riding the bonded link.**
- It only helps things on **data**: VoIP apps, streaming, browsing, texts over data.
- It can't create signal from nothing — a phone with zero bars and no Wi-Fi has no path.
- The "host" phone doing the bonding runs hot / drains fast — keep it plugged in.

---

## The one thing to build next (priority order)

1. **Gate 1**: glorytun external-fd patch + per-path `bindSocket` → real bonding + failover.
2. **Gate 2**: proxy-based reshare to peer devices.
3. Verify Wi-Fi Calling flows through the tunnel (the real dropped-call fix).

Definition of done for Gate 1: `glorytun show` on the VPS lists TWO active paths
from the phone; killing one radio mid-stream does not drop a call/stream on a
client device; a client with no SIM stays online purely through the bond.

---

## Where the code lives

| Area | Path |
|---|---|
| Native VPN service (bonding) | `native/android/BondVpnService.kt` |
| Capacitor bridge | `native/android/MeshBondingPlugin.kt` |
| The MISSING glorytun patch | `native/patches/` (spec in its README) |
| glorytun cross-compile | `native/scripts/build-glorytun-android.sh` |
| Accelerator tuning | `native/scripts/accelerator-tune.sh` |
| MeshDrop relay + installer | `native/scripts/meshdrop-relay.js`, `install-meshdrop-relay.sh` |
| Web ↔ engine seam | `lib/mesh-client.ts`, `lib/native-adapter.ts` |
| Data shapes | `lib/mesh-data.ts` |
| Full engineering brief | `native/HANDOFF.md` |
| VPS blueprint | `docs/vps-bonding-setup.md` (says 65001/10.9.0.x — LIVE is 5000/10.99.0.x) |
