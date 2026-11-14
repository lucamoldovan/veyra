# Veyra architecture

## Product boundary

Veyra is an NDI video receiver/player. It is not a church-management system, signage CMS, or centrally managed fleet platform. The first deployment context is a church, but the software is designed as a general-purpose network-video receiver.

## Runtime model

One native process owns the display and playback lifecycle. It runs locally on the receiver and does not depend on a remote dashboard or internet connection.

Core subsystems:

- **NDI discovery:** enumerate sources on the LAN and expose stable source identity plus display name.
- **NDI receiver:** connect to the selected source, receive video frames, detect stale/missing frames, and reconnect.
- **Renderer:** present frames in a fullscreen SDL2 window at the configured output size.
- **Playback controller:** coordinate startup, source selection, connection loss, reconnect attempts, and error states.
- **Configuration:** load and validate a local configuration file; retain safe defaults when optional values are absent.
- **Logging/health:** report state transitions and meaningful errors without flooding logs.

## Threading principles

Keep NDI frame reception separate from rendering so a slow display operation cannot block frame acquisition. Use a bounded frame queue; when overloaded, prefer the newest frame rather than building latency with stale frames. Protect shared state explicitly and make shutdown cooperative.

The first implementation should avoid unnecessary worker threads. Add complexity only where the SDK or measured performance requires it.

## Playback state model

- `STARTING`: initialize configuration, SDL, and NDI runtime.
- `DISCOVERING`: enumerate available sources.
- `DISCONNECTED`: no selected source is currently available.
- `CONNECTING`: attempting to connect to the selected source.
- `PLAYING`: fresh video frames are being presented.
- `RECONNECTING`: the source disappeared or frames became stale; retrying.
- `ERROR`: unrecoverable initialization or runtime failure.

A missing source is not, by itself, a reason to reboot the machine. Recreate/reconnect the receiver first and report the state clearly.

## Local configuration

Initial configuration lives at `/etc/veyra/config.json` for system installations. Development builds may accept an explicit config path.

Example:

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
  },
  "reconnect": {
    "enabled": true,
    "initialDelayMs": 1000,
    "maxDelayMs": 10000
  },
  "logging": {
    "level": "info"
  }
}
```

Source identity should use the strongest stable identifier provided by the NDI SDK (for example, the source URL/address) rather than relying only on a human-readable name. The exact SDK fields will be confirmed during implementation.

## Target environment

- Debian 13, 64-bit x86_64, XFCE during development
- Apple Mac mini (Late 2014), Intel Core i5-4278U, 8 GB RAM, Intel Iris 5100
- Initial target output: 1920×1080 at 30 FPS
- Wired LAN preferred

The initial hardware has a mechanical HDD; development must not assume an SSD. Actual performance and long-duration stability must be measured on the target hardware when it is available.

## Failure handling

- NDI source disappears: mark the stream unavailable and retry with bounded backoff.
- No frames arrive: detect frame staleness independently of discovery state.
- Renderer fails: log the failure and attempt controlled recovery where safe.
- Process exits: systemd restarts it.
- Machine reboots: systemd starts Veyra automatically.
- Network is unavailable: remain alive, continue discovery/retry, and recover when the LAN returns.

## Security and licensing

Veyra should not expose a network control server in its first version. NDI traffic remains on the local network. Do not bundle or redistribute NDI SDK binaries until the applicable SDK license and redistribution terms have been reviewed.
