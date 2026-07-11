# MeshLink — VPS Bonding Server + Native Plugin Spec

This is the buildable blueprint for the engine behind the dashboard. Three parts:

1. **The droplet** (the bonding "brain" that reassembles your links)
2. **The bonding engine** (glorytun — DIY Speedify)
3. **The native plugin + API contract** (what the Capacitor app calls)

---

## 0. How the pieces fit

```
 T-Mobile (M7 Pro) ──WiFi──┐
                           ├─► HOST PHONE (Capacitor + Kotlin plugin)
 host phone's SIM ─────────┘        │  splits packets across both links
                                    │  (glorytun-udp tunnels)
                                    ▼
                        DROPLET / VPS  ← reassembles, NATs to internet
                                    │
                                    ▼
                                INTERNET
```

The droplet is mandatory: it is the single point where your two split links are
merged back into one ordered stream. Without it, the internet sees two unrelated
IPs, not one bonded pipe.

---

## 1. Droplet configuration (DigitalOcean)

### Recommended spec

| Setting | Value | Why |
|---|---|---|
| Plan | **Basic / Premium Intel, 2 vCPU / 2 GB** | glorytun is light on CPU; encryption is the only load. 2 vCPU handles ~1 Gbps. |
| **Transfer** | **Pick the highest-transfer plan you can** | This is the #1 factor. Two bonded 5G links can burn TB/month. Overage is billed. |
| Region | **Closest datacenter to you** (e.g. NYC/SFO) | Every packet detours through here — nearest region = least added latency. |
| OS | **Ubuntu 24.04 LTS** | Modern kernel, MPTCP available if you want it later. |
| Networking | Enable **IPv4** (you need the public static IP) | The tunnel endpoint. |

> Start at 2 vCPU / 2 GB. If you saturate it, resize up — DO resizes in minutes.
> A $12–24/mo droplet is plenty to prove the concept; scale transfer, not CPU.

### First-boot hardening (run as root)

```bash
# Update
apt update && apt -y upgrade

# Create a non-root admin user
adduser mesh
usermod -aG sudo mesh

# Basic firewall — SSH + the glorytun UDP port only
ufw allow OpenSSH
ufw allow 65001/udp        # glorytun tunnel port (chosen below)
ufw --force enable

# Enable IP forwarding (REQUIRED — lets the droplet route tunnel traffic out)
cat >> /etc/sysctl.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF
sysctl -p
```

---

## 2. Install & configure glorytun (the bonding engine)

glorytun-udp is a multipath UDP VPN — the closest DIY equivalent to Speedify.
Each physical link on the host phone opens its own path to the droplet; glorytun
schedules packets across all paths and reorders on arrival.

### Build glorytun on the droplet

```bash
apt -y install git build-essential autoconf automake libtool pkg-config
git clone https://github.com/angt/glorytun --recursive
cd glorytun
./autogen.sh && ./configure && make && sudo make install
```

### Generate a shared key (used by BOTH droplet and phone)

```bash
glorytun keygen > /etc/glorytun.key
chmod 600 /etc/glorytun.key
cat /etc/glorytun.key   # copy this — the phone needs the identical key
```

### Create the server tunnel interface

```bash
# tun0 = the bonded virtual interface on the server side
# 10.9.0.1 = server tunnel IP, 10.9.0.2 = phone tunnel IP
ip tuntap add mode tun tun0
ip addr add 10.9.0.1/24 dev tun0
ip link set tun0 up
```

### NAT: send bonded traffic out the droplet's real interface

```bash
# eth0 = the droplet's public interface (check with `ip route get 1.1.1.1`)
iptables -t nat -A POSTROUTING -s 10.9.0.0/24 -o eth0 -j MASQUERADE
iptables -A FORWARD -i tun0 -o eth0 -j ACCEPT
iptables -A FORWARD -i eth0 -o tun0 -m state --state RELATED,ESTABLISHED -j ACCEPT

# Persist iptables across reboots
apt -y install iptables-persistent
netfilter-persistent save
```

### Run glorytun server (multipath enabled)

```bash
glorytun-udp \
  bind 0.0.0.0 port 65001 \
  keyfile /etc/glorytun.key \
  dev tun0 \
  multiqueue \
  &
```

### Make it a service (survives reboot)

```bash
cat > /etc/systemd/system/glorytun.service <<'EOF'
[Unit]
Description=glorytun bonding server
After=network-online.target
Wants=network-online.target

[Service]
ExecStartPre=/sbin/ip tuntap add mode tun tun0
ExecStartPre=/sbin/ip addr add 10.9.0.1/24 dev tun0
ExecStartPre=/sbin/ip link set tun0 up
ExecStart=/usr/local/bin/glorytun-udp bind 0.0.0.0 port 65001 keyfile /etc/glorytun.key dev tun0 multiqueue
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now glorytun
systemctl status glorytun
```

### Prove it works BEFORE writing any app

From a Linux laptop with two USB tethers (or any 2 interfaces), run the glorytun
client pointing at `YOUR_DROPLET_IP port 65001` with the same keyfile. Then:

```bash
curl --interface tun0 https://ifconfig.me   # should return the DROPLET's IP
```

If that returns the droplet IP, bonding works. Everything else is client software.

---

## 3. Native plugin (Capacitor + Kotlin) — the host phone engine

The web dashboard (this project) runs in the Capacitor WebView. The bonding engine
is a **custom Kotlin plugin** the WebView calls. This is the part that CANNOT be
done in the WebView alone.

### Android manifest permissions

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE"/>
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE"/>
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"/>
<!-- VpnService is declared as a <service>, not a permission -->
```

### The three native capabilities the plugin wraps

| Capability | Android API | Purpose |
|---|---|---|
| Hold WiFi **and** cellular at once | `ConnectivityManager.requestNetwork()` with `NetworkCapabilities` + `Network.bindSocket()` | Keep both radios live; bind each glorytun path to a specific link |
| Build the tunnel | `VpnService` (foreground service) | Capture device traffic into the bonded tunnel |
| Share to peers | `WifiManager` SoftAP / LocalOnlyHotspot + on-device SOCKS proxy; `BluetoothPan` (NAP) | Let the other 11 devices ride the bonded pipe |

### Plugin API surface (what the WebView calls)

```typescript
// The TypeScript interface the dashboard imports
export interface MeshBondingPlugin {
  // Start the bonded tunnel to the droplet
  startBond(opts: {
    serverIp: string;      // droplet public IP
    serverPort: number;    // 65001
    key: string;           // the glorytun key
  }): Promise<{ status: 'connected' | 'error'; message?: string }>;

  stopBond(): Promise<void>;

  // Enable/disable an individual physical link (drives the dashboard toggles)
  setLinkEnabled(opts: { link: 'wifi' | 'cellular'; enabled: boolean }): Promise<void>;

  // Start sharing the bonded connection to peer devices
  startSharing(opts: { ssid: string; password: string; bluetooth: boolean }): Promise<void>;
  stopSharing(): Promise<void>;

  // Live telemetry — the dashboard subscribes to this
  addListener(
    event: 'telemetry',
    cb: (data: LinkTelemetry) => void
  ): Promise<PluginListenerHandle>;
}

export interface LinkTelemetry {
  links: {
    id: 'wifi' | 'cellular';
    up: boolean;
    downMbps: number;
    upMbps: number;
    latencyMs: number;
    signal: number;   // 0-4
  }[];
  aggregate: { downMbps: number; upMbps: number };
  peers: { id: string; name: string; transport: 'wifi' | 'bluetooth'; usageMbps: number }[];
}
```

The `LinkTelemetry` shape intentionally matches `lib/mesh-data.ts` in this project,
so swapping the simulated engine for the real plugin is a drop-in replacement.

---

## 4. Wiring the dashboard to the real plugin (later)

In `lib/mesh-data.ts` the simulated tick loop is isolated. To go live:

1. `npm i @capacitor/core` and add the plugin.
2. Replace the `setInterval` simulation with `MeshBonding.addListener('telemetry', ...)`.
3. Point `startBond()` at your droplet IP + key from a settings screen.

Everything visual in the dashboard already renders off the `LinkTelemetry` shape.

---

## 5. iOS note (companion only)

On iPhone/iPad, the equivalent plugin uses `NEPacketTunnelProvider` (needs the
Network Extension entitlement from your Apple developer account). It gives
**failover + partial MPTCP bonding on a single device** and works great as a
**client** of a host phone's shared network — but iOS cannot be the device that
*shares* the bonded pipe. Build Android host first; add the iOS client after.

---

## Quick checklist

- [ ] Spin up Ubuntu 24.04 droplet, highest transfer you can, nearest region
- [ ] Harden + enable `ip_forward`
- [ ] Build glorytun, generate key, save it
- [ ] Configure tun0 + NAT + systemd service
- [ ] Verify with a laptop: `curl --interface tun0 ifconfig.me` returns droplet IP
- [ ] Build Capacitor Android app with the Kotlin bonding plugin
- [ ] Drop this dashboard into the Capacitor shell, wire telemetry listener
- [ ] Add iOS client last
