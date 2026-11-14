# Deployment, fullscreen and update architecture

Status: implementation plan for `feature/deployment-and-updates`.
This document defines the target architecture. Items marked "planned" are not implemented merely because they appear here.

## Goals

- Preserve the working `main` branch. All work in this document belongs on `feature/deployment-and-updates`.
- Deploy the receiver to Intel x86_64 Mac mini hardware without rebuilding or reinstalling the operating system for normal application updates.
- Run the central Veyra server and dashboard on a separate always-on PC.
- Support frequent development updates now and safe, controlled production updates later.
- Keep device identity, pairing credentials, configuration, and cached fallback media separate from replaceable application binaries.
- Make the receiver start in fullscreen after boot and recover from ordinary application/display failures.

## Deployment roles

### Receiver Mac mini

Target OS: Debian 13 x86_64, subject to a hardware validation pass on the exact Mac mini model.
Install the native Veyra receiver, its runtime dependencies, the official NDI SDK runtime/library, Avahi, and a dedicated non-admin kiosk account.

Keep mutable state outside the release directory:
- Application releases: `/opt/veyra/releases/<version>/`
- Active release pointer: `/opt/veyra/current` (symlink)
- Machine configuration: `/etc/veyra/veyra.json`
- Credentials and device identity: `/var/lib/veyra/identity/`
- Download/cache/fallback media: `/var/cache/veyra/` or a dedicated persistent cache directory

The exact paths must be reconciled with the current receiver's credential/cache path handling before implementation. Do not move or overwrite existing state until a migration is tested.

### Central server PC

Run Debian 13 x86_64 (or another explicitly tested Linux server OS), Node.js 22+, the Veyra server, SQLite, and the dashboard's production build. Give the server a stable LAN address or DNS name.

The server must be configured with TLS before listening on a LAN interface. Do not expose the current development server or authenticated device APIs over plaintext LAN. Receivers must validate the server certificate using a configured CA/certificate trust path.

The central server becomes the update coordinator and LAN artifact cache. Each receiver should download an artifact from the central server, not independently fetch the same GitHub release.

## Update channels and release model

### Development channel (early testing)

- A developer explicitly publishes or selects a tested development build.
- The central server checks for a newer build and downloads it once.
- The dashboard shows current version, offered version, release notes, and update status per receiver.
- Updates can be started for one device or a selected group. Do not silently update every device by default.
- Development builds may be frequent, but should still be immutable, versioned artifacts. Avoid a blind `git pull` and local compilation on every receiver boot: receivers should not need Git credentials, compilers, source trees, or NDI SDK development files.
- If a source-build workflow is temporarily needed on the first physical test unit, keep it a developer-only bootstrap path and do not make it the fleet update mechanism.

### Stable channel (later)

- Publish signed, versioned release artifacts for each supported target architecture/OS.
- Include a manifest with version, channel, platform/architecture, artifact URL or server-relative artifact identifier, SHA-256, signature/key identifier, release notes, and compatibility metadata.
- Verify signature and checksum before installation. HTTPS alone is not a substitute for artifact integrity verification.
- Stage into a new version directory, verify required files, stop the receiver service, switch the active symlink, restart, and run a health check.
- If health check fails or the receiver does not become healthy within a bounded timeout, restore the previous symlink and restart the previous release.
- Retain at least the previous known-good release until the new one has passed health checks.
- Enforce minimum compatible server/API version and configuration schema version before offering an update.

### Receiver update state machine

Suggested states: `up-to-date`, `update-available`, `downloading`, `verified`, `installing`, `restarting`, `healthy`, `rolled-back`, `failed`.
Persist state and timestamps on the server so the dashboard remains useful after a browser refresh or server restart. Device-side logs should record the update ID and outcome without exposing tokens or secrets.

## How the dashboard updates

The dashboard is a web application, so receivers do not need a dashboard updater and operators should not have to install anything on their laptops.

Recommended first production model:
1. Build the dashboard as part of a versioned central-server release.
2. Package the built static assets with that server release and serve them from the Veyra server's production HTTP origin.
3. Update the central server using a separate updater/deployment service or operator-controlled package step. Do not have the running Node process overwrite its own executable files.
4. Keep the previous server release available and use the same staged activation/health-check/rollback approach.
5. On activation, the server serves the new dashboard assets. Browsers fetch the new HTML on next navigation/refresh; hashed asset filenames avoid stale JS/CSS collisions. Set HTML to revalidate/no-cache and hashed assets to long-lived immutable caching.
6. Display server version, dashboard build version, and API compatibility in the dashboard's About/System area. If a browser has stale assets, show a clear reload prompt rather than failing silently.

For the first implementation, keep dashboard and server versions coupled in one tested release. A separately deployed dashboard artifact can be considered later if there is a real need for independent release cadence. If split later, publish a dashboard artifact with its own version and a declared supported server API range; never let an incompatible dashboard silently talk to an older server.

The dashboard should expose:
- Server version and dashboard version
- Receiver current version, update channel, and latest available version
- Check for updates / refresh status
- Update one receiver, selected receivers, or a controlled rollout group
- Per-device progress, timestamps, success/failure reason
- Update policy: manual by default; optional scheduled/automatic updates later
- Release notes and rollback action where safe
- Clear warning when a device is offline or running an incompatible version

## Fullscreen, boot and recovery

Target behavior: power is applied -> Linux boots -> graphical display session becomes ready -> Veyra receiver launches automatically -> receiver renders fullscreen -> it reconnects to the configured NDI source and control server when available.

Implementation work:
1. Validate Debian 13 on the exact Intel Mac mini: boot, Ethernet, Wi-Fi if needed, HDMI/DisplayPort output, resolution/refresh rates, Intel graphics driver, audio not required, and NDI performance.
2. Choose and test a lightweight Xorg-based kiosk session first for SDL2 compatibility. Do not assume Wayland/DRM behavior until tested. Disable screen blanking, DPMS sleep, screensaver, desktop notifications, and power-saving behaviors that interrupt output.
3. Create a dedicated unprivileged `veyra` account. Do not run the receiver as root.
4. Configure automatic login into the dedicated kiosk session, with no interactive desktop steps required after power loss.
5. Launch the receiver only after the display session is available. Prefer a systemd-managed service integrated with the graphical session (or a carefully tested systemd user service); do not start SDL before a valid display exists.
6. Set restart-on-failure with a sensible delay and rate limit. Avoid rapid crash loops. Add structured logs and a simple local health signal.
7. Verify fullscreen is truly borderless/fullscreen at the target output resolution and survives unplug/replug, display mode changes, source loss/reappearance, and application restart.
8. Add a maintenance escape path for authorized local maintenance without exposing normal desktop controls to viewers.
9. Test cold boot, power interruption, server offline at boot, NDI sender offline at boot, network interruption, and 24-hour playback.

Do not assume the current `display.fullscreen` configuration option alone provides kiosk startup, automatic login, display power management, or service recovery. Those are separate OS/session/service responsibilities.

## Release pipeline

Extend CI in stages:
- Keep existing SDK-independent CI tests.
- Add a protected/manual release job that builds the full native receiver against the official NDI SDK in a controlled environment where SDK licensing permits it.
- Build server and dashboard production artifacts with pinned Node version and lockfiles.
- Produce checksums and signed manifests; store signing private keys outside the repository and CI logs.
- Publish immutable GitHub Releases for development/stable channels.
- Have the central server mirror approved artifacts into its LAN cache.
- Test upgrades from the previous release and rollback on a clean Debian 13 image before broad rollout.

The public CI currently disables the native player because the official NDI SDK is proprietary/not available in the public runner. Do not mark a full receiver release as validated until the SDK-enabled build and hardware tests have actually passed.

## Compatibility and security rules

- Keep device credentials, pairing identity, local config, and media cache outside replaceable application releases.
- Never place secrets in Git, release archives, logs, browser storage, or dashboard API responses.
- Require TLS for LAN server traffic and verify certificates on receivers.
- Verify signed release metadata and artifact checksums before installation.
- Validate OS, architecture, server/API compatibility, and config schema before applying an update.
- Use least-privilege service accounts and narrowly scoped file permissions.
- Make update operations idempotent and record an audit trail.
- Do not run `git pull`, `npm install`, or a compiler as part of normal receiver boot/update.
- Preserve the currently working `main` branch; changes are reviewed and tested on this feature branch before any merge.

## Implementation order and acceptance criteria

1. **Inventory and baseline:** inspect current receiver/server/dashboard code and config paths; record the exact working commit and test commands. No behavior changes.
2. **Physical receiver baseline:** install Debian 13 on one test Mac mini; validate graphics, network, NDI SDK/runtime, and video output.
3. **Kiosk lifecycle:** implement and test automatic graphical session, fullscreen launch, restart behavior, logging, and maintenance access.
4. **Release packaging:** define version format, target platform, immutable artifact layout, manifest schema, checksums/signatures, and compatibility checks.
5. **Receiver updater:** implement staging, verification, activation, health check, rollback, and persistent update status.
6. **Server update coordinator:** add artifact cache, device rollout controls, update status APIs, and authorization/audit checks.
7. **Dashboard update and UI:** serve the production dashboard from the server release; show versions, update availability, progress, errors, and release notes.
8. **CI/release automation:** add SDK-enabled release build where licensing permits, package server/dashboard/receiver, sign, publish, and test.
9. **Fleet validation:** test one device, then a small group, then wider rollout. Manual approval remains default until reliability is proven.

A stage is complete only when its acceptance tests pass and its implementation is reflected in code/tests/docs. This plan is not a claim that these features are already implemented.
