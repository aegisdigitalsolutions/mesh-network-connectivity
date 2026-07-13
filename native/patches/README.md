# glorytun Android patches

## Current approach: `../scripts/patch-glorytun.py` (ACTIVE)

The hand-written unified-diff patches that used to live here could not apply:
they were written against an imagined source layout that does not match real
glorytun **v0.3.4** (commit `c113724`). In actual v0.3.4:

- `tun_create(char *name, size_t len, const char *dev_name)` takes three args,
  and there is **no** `tun_set_mtu()` in `src/tun.c`.
- control sockets are located via `ctl_rundir()` + `ctl_create(const char *file)`,
  not the `ctl_create(dir, file)` the old patch assumed.

So instead of brittle line-numbered diffs, the build now runs
**`native/scripts/patch-glorytun.py`**, a string-anchored patcher matched to the
real v0.3.4 source. It inserts exactly two shims:

1. **`src/tun.c` → `tun_create()`** — if `GT_TUN_FD` is set, adopt that fd (the one
   handed over by Android `VpnService.establish()`) instead of opening
   `/dev/net/tun` (which EPERMs on unrooted Android).
2. **`src/ctl.c` → `ctl_rundir()`** — if `GT_RUNDIR` is set, use it, because
   Android's `/run` is not writable and glorytun needs a writable control dir.

This is **Gate 1**: a single-link tunnel to the droplet. Loop-prevention is handled
on the Android side by `addDisallowedApplication(packageName)` in
`BondVpnService.kt`, so it works with **vanilla mud** — no mud patch required.

## `glorytun-mud-fd-helper.patch` (Gate 2, NOT yet wired into the build)

Kept for reference only. This is the socket-per-path + SCM_RIGHTS fd-helper work
needed for true dual-radio bonding (Gate 2). It is **not** applied by the current
build script. Before enabling it, it must be re-expressed against the real
`mud/mud.c` from the pinned submodule (its `mud_addr_to_sockaddr` /
`mud_addr_to_str` anchors need to be matched to the actual helper names), and the
`protect()`/`bindSocket()` path in `BondVpnService.startFdHelper()` becomes active.
