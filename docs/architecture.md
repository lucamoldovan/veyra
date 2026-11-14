# Veyra architecture

## Product boundary

Veyra is an NDI video receiver/player. It is not a church-management system, signage CMS, or centrally managed fleet platform. The first deployment context is a church, but the software is designed as a general-purpose network-video receiver.

## Runtime model

One native process owns the display and playback lifecycle. It runs locally on the receiver and does not depend on a remote dashboard or internet connection.

Core subsystems:

- **NDI discovery:** enumerate LAN sources and copy their display name and URL into Veyra-owned strings.
- **NDI receiver:** connect to the selected source, receive video frames, report connection state, and rely on the SDK's automatic reconnect behavior.
- **Renderer:** present video in a fullscreen SDL2 window while preserving the source aspect ratio.
- **Playback loop:** coordinate source selection, frame freshness, black-screen fallback, and shutdown.
- **Configuration:** load and validate a local JSON file.
- **Logging:** report startup, source selection, playback transitions, and failures.

## Threading and frame ownership

The SDL event/render loop runs on the main thread. NDI frame capture runs on a dedicated worker thread.

The capture worker copies each supported NDI frame into Veyra-owned memory and frees the SDK frame immediately. It publishes into a single latest-frame slot protected by a mutex. If rendering falls behind, a newer frame replaces the pending frame rather than allowing latency to grow without bound.

The capture thread uses a bounded timeout so shutdown can request a stop and join the worker before destroying the receiver or global NDI runtime.

## NDI receive format

The receiver requests NDI's UYVY/BGRA receive format:

- Sources without alpha are delivered as packed UYVY.
- Sources with alpha are delivered as BGRA.
- Audio and metadata pointers passed to the NDI capture function are null; Veyra does not receive or play NDI audio.
- Interlaced sources are deinterlaced by the SDK by setting the video-fields option to false.

UYVY is uploaded directly to an SDL streaming texture when supported. SDL's YUV conversion mode is set to automatic so SD uses BT.601 and HD uses BT.709. If the renderer cannot create or lock a UYVY texture, Veyra converts the frame to BGRA and uses a BGRA texture instead, using the same SD/HD matrix choice.

## Source selection

The preferred configured identity is the NDI source URL/address (ndi.sourceAddress). If it is not configured, Veyra can select by exact source name (ndi.sourceName).

If neither is configured, Veyra automatically selects a source only when exactly one source remains after an initial five-second discovery period and a further two-second stable-source window. It does not arbitrarily choose between multiple sources. The --list-sources command prints the discovered names and addresses without opening the display.

The finder owns the source array returned by the current-sources API. Veyra copies the name and URL before calling the finder again.

## Playback and recovery

- No configured source is found: keep the display black and continue discovery.
- Source is discovered: create a receiver and start the capture worker.
- Fresh video arrives: render it and mark playback active.
- No fresh frame for two seconds: clear the display and report the loss once.
- Source disappears: keep the receiver alive; the NDI SDK automatically attempts to reconnect when the source returns.
- Process exits unexpectedly: the deployment service should restart it.
- Machine reboots: the deployment service should start it after the graphical session is available.

The application does not reboot the machine because a source is unavailable.

## Local configuration

The default configuration path is /etc/veyra/config.json. Development builds may pass another path using --config.

Supported version-1 configuration:

```json
{
  "schemaVersion": 1,
  "ndi": {
    "sourceName": "",
    "sourceAddress": ""
  },
  "display": {
    "width": 1920,
    "height": 1080,
    "targetFps": 30,
    "fullscreen": true,
    "vsync": true
  }
}
```

The display dimensions configure the window when it is not fullscreen. Fullscreen desktop mode uses the display's current desktop resolution. targetFps caps the presentation cadence; when frames arrive faster than the configured rate, the latest-frame slot replaces older pending frames.

## Target environment

- Debian 13, 64-bit x86_64, XFCE/X11 during development
- Apple Mac mini (Late 2014), Intel Core i5-4278U, 8 GB RAM, Intel Iris 5100
- Initial target output: 1920×1080 at 30 FPS
- Wired LAN preferred
- Avahi daemon available and running for LAN discovery

The initial hardware has a mechanical HDD; development must not assume an SSD. Actual performance and long-duration stability must be measured on the target hardware when it is available.

## Current validation boundary

The configuration loader has SDK-independent unit tests and runs in GitHub Actions. The complete player still needs to be built against the installed official NDI SDK and SDL2 on Debian 13, then tested with real NDI senders and the target Mac mini.

## Security and licensing

Veyra does not expose a network control server. NDI traffic remains on the local network. Do not bundle or redistribute NDI SDK binaries until the applicable SDK license and redistribution terms have been reviewed.
