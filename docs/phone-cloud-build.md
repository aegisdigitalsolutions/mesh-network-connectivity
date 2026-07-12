# MeshLink — Phone-Only Cloud Build (GitHub Actions)

You have **no computer**, so we build the APK in the cloud. GitHub gives free Linux
build machines with the Android SDK preinstalled. You trigger the build from your
phone's browser and download the finished APK straight to the phone.

```
v0 project -> GitHub repo -> GitHub Actions (builds APK) -> download APK to phone -> install
```

---

## Staged plan (why we do it in two parts)

Building the cloud pipeline AND the hard native bonding engine at the same time is a
recipe for confusing failures. So:

- **Stage 1 (this file, now):** produce an **installable APK of the app UI**. It runs
  in **simulation mode** on your phone — proves the whole cloud pipeline works and
  puts a real app in your hand. No native code yet.
- **Stage 2 (next):** inject the real glorytun engine (`BondVpnService` +
  `libglorytun.so`) so the "Connect" button actually bonds to your droplet. This is
  the hard part we debug together using the cloud build logs.

---

## One-time setup (from your phone)

### 1. Push this project to GitHub
In v0, open the top-right settings menu and connect / push to a **GitHub repository**.
This uploads everything including `.github/workflows/build-apk.yml`.

### 2. Confirm the workflow is there
On your phone, open the repo on **github.com** (the mobile site works fine, or the
GitHub mobile app). Tap the **Actions** tab. You should see a workflow named
**"Build MeshLink APK"**.

> If GitHub asks you to enable Actions for the repo the first time, tap the green
> "I understand my workflows, enable them" button.

---

## Building the APK (repeat this every time you want a new build)

1. Repo -> **Actions** tab -> click **"Build MeshLink APK"** on the left.
2. Tap **"Run workflow"** -> select branch `main` -> **"Run workflow"** (green button).
3. Wait ~5-10 minutes. Tap the run to watch the steps turn green.
4. When it finishes, scroll to the bottom of the run page to the **Artifacts**
   section. Tap **"MeshLink-debug-apk"** to download the `.zip`.
5. On your phone, open the downloaded zip, extract `app-debug.apk`, and tap it to
   install. You'll need to allow **"Install unknown apps"** for your browser/files
   app the first time (Android will prompt you).

That's it — MeshLink is now on your phone.

---

## What Stage 1 gives you

- The full dashboard UI, running natively.
- Simulation mode: throughput graphs, uplink cards, device list, connect/disconnect —
  all animated, so you can confirm the app works end to end.
- The settings screen already pre-fills your droplet `159.203.67.127:5000`.

**What it does NOT do yet:** actually bond your connections. The "Connect" button
drives the simulator until Stage 2 adds the native engine. That's expected.

---

## If a build fails

Every step's log is viewable on your phone. Tap the failed (red X) step to expand its
log, copy the error text, and paste it back into v0. The most likely Stage 1 snags:

- **Static export error** during "Build static web export" — usually a page using a
  server-only feature. Paste the error; it's a quick fix.
- **`cap add android` fails** — usually a missing `out/` folder, meaning the web build
  above didn't finish. The log will show which.
- **Gradle error** — Android toolchain issue; paste the `--stacktrace` output.

Once Stage 1 produces an installable APK, tell me and we move to Stage 2: the real
glorytun bonding engine.
