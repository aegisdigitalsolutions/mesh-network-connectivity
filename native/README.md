# MeshLink native bonding package (Stage 2)

This folder is a **self-contained handoff** for making the "Connect" button perform
real connection bonding. It is meant to be worked on in a full Android/NDK
environment and brought back into this repo.

**Start here:** [`HANDOFF.md`](./HANDOFF.md) — full context, what works, what
doesn't, and the exact task list.

```
native/
├── HANDOFF.md                        ← read first: the complete brief
├── android/
│   ├── BondVpnService.kt             ← VpnService: tun + dual-radio + glorytun launch
│   ├── MeshBondingPlugin.kt          ← Capacitor bridge (window.MeshBonding)
│   └── AndroidManifest.additions.xml ← permissions + service entry to merge
├── scripts/
│   └── build-glorytun-android.sh     ← NDK cross-compile → jniLibs/arm64-v8a/libglorytun.so
└── patches/
    └── README.md                     ← spec for the MISSING glorytun fd patch (Task A)
```

## The one thing that must be solved
Upstream glorytun opens its own tun device; unrooted Android forbids that. It must
be patched to accept the file descriptor from `VpnService.establish()`. See
`patches/README.md` and `HANDOFF.md` §3. Everything else is wiring around this.

## Ground truth
- Droplet `159.203.67.127`, UDP `5000`, cipher `aegis256`, tunnel `10.99.0.0/24`
- App id `com.meshlink.app`, web export dir `out/`
- Server is live and reboot-proof; web UI + cloud APK build are done.
