#!/usr/bin/env python3
"""
String-anchored patcher for glorytun v0.3.4 (commit c113724).

Venice's hand-written unified-diff patches assumed a source layout that does not
match real v0.3.4 (wrong tun_create signature, a tun_set_mtu that doesn't exist,
and a ctl_create(dir,file) that is actually ctl_rundir()+ctl_create(file)).
Rather than fight git-apply line numbers, we anchor on real function signatures
and insert the two Android shims we actually need:

  1. src/tun.c  -> tun_create(): if GT_TUN_FD is set, adopt that fd (the fd handed
     over by Android VpnService.establish()) instead of opening /dev/net/tun.
  2. src/ctl.c  -> ctl_rundir(): if GT_RUNDIR is set, use it (Android /run is not
     writable; we point glorytun's control socket at the app's filesDir).

Idempotent: re-running is a no-op. Run from the glorytun checkout root.
"""
import re
import sys
import os

TUN = "src/tun.c"
CTL = "src/ctl.c"

TUN_SHIM = """
    /* MeshLink Android: adopt the tun fd created by VpnService.establish().
       When GT_TUN_FD is set we must NOT touch /dev/net/tun (EPERM, unrooted). */
    {
        const char *gt_fd = getenv("GT_TUN_FD");
        if (gt_fd && gt_fd[0]) {
            int envfd = (int)strtol(gt_fd, NULL, 10);
            if (envfd < 0)
                return -1;
            int fl = fcntl(envfd, F_GETFL, 0);
            if (fl != -1)
                fcntl(envfd, F_SETFL, fl | O_NONBLOCK);
            snprintf(name, len, "tun-vpn");
            return envfd;
        }
    }
"""

CTL_SHIM = """
    /* MeshLink Android: /run is unwritable; honor GT_RUNDIR (app filesDir). */
    {
        const char *gt_rundir = getenv("GT_RUNDIR");
        if (gt_rundir && gt_rundir[0]) {
            if (dst && size) {
                int r = snprintf(dst, size, "%s", gt_rundir);
                if (r > 0 && (size_t)r < size)
                    return dst;
            }
            return NULL;
        }
    }
"""


def die(msg):
    print(f"!! patch-glorytun: {msg}", file=sys.stderr)
    sys.exit(1)


def ensure_include(content, after_include, new_include):
    if new_include in content:
        return content
    anchor = f'#include {after_include}'
    if anchor not in content:
        die(f"could not find include anchor {after_include}")
    return content.replace(anchor, f'{anchor}\n#include {new_include}', 1)


def insert_after_brace(content, signature_regex, shim, tag):
    if tag in content:
        print(f"   {tag} already present, skipping")
        return content
    pat = re.compile(signature_regex + r'\s*\{')
    m = pat.search(content)
    if not m:
        die(f"could not locate function for {tag} (regex: {signature_regex})")
    end = m.end()
    return content[:end] + shim + content[end:]


def patch_file(path, do):
    if not os.path.isfile(path):
        die(f"missing {path} (run from glorytun checkout root)")
    with open(path, "r") as f:
        content = f.read()
    content = do(content)
    with open(path, "w") as f:
        f.write(content)
    print(f"   patched {path}")


def do_tun(content):
    content = ensure_include(content, '"tun.h"', '<stdlib.h>')
    content = insert_after_brace(
        content,
        r'tun_create\(char \*name, size_t len, const char \*dev_name\)',
        TUN_SHIM,
        "GT_TUN_FD",
    )
    return content


def do_ctl(content):
    content = ensure_include(content, '"str.h"', '<stdlib.h>')
    content = insert_after_brace(
        content,
        r'ctl_rundir\(char \*dst, size_t size\)',
        CTL_SHIM,
        "GT_RUNDIR",
    )
    return content


def main():
    print("==> Applying MeshLink Android shims (string-anchored)")
    patch_file(TUN, do_tun)
    patch_file(CTL, do_ctl)
    print("==> Shims applied OK")


if __name__ == "__main__":
    main()
