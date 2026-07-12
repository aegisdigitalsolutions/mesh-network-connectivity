# glorytun Android patches

## `glorytun-android-fd.patch` (TO BE CREATED)

This is the single most important piece of unfinished engineering.

**Problem:** Upstream glorytun calls `tun_create()` to open its own `/dev/net/tun`
device by name. On unrooted Android this is not permitted — only `VpnService` may
create a tun, and it hands back an already-open **file descriptor**, not a device
name.

**Required change:** Add a `fd <n>` argument (or `GLORYTUN_TUN_FD` env var) to the
`bind` command that makes glorytun **use the passed descriptor directly** instead
of creating its own. Concretely, in the tun-setup path (`src/tun.c` /
`src/bind.c`), when an external fd is provided:

- skip `open("/dev/net/tun")` and the `TUNSETIFF` ioctl,
- `dup()` the provided fd and use it as the tunnel fd,
- set it non-blocking (`O_NONBLOCK`) to match glorytun's event loop.

`BondVpnService.kt` already passes `fd <tunFd>` on the command line, so once this
patch exists and is committed here, `build-glorytun-android.sh` applies it
automatically and the bundled binary becomes functional.

Until this patch exists, the compiled binary runs but cannot attach to the tunnel
on an unrooted device.
