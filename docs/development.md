# Development plan

## Phase 1 — Build foundation

- [ ] C++20 project and CMake configuration
- [ ] Dependency discovery for SDL2, spdlog, nlohmann/json, and NDI SDK
- [ ] Configuration loading and validation
- [ ] Structured logging
- [ ] Clean startup/shutdown path

## Phase 2 — NDI discovery and receiving

- [ ] Initialize and shut down the NDI runtime safely
- [ ] Discover and list available sources
- [ ] Select a source by stable identity
- [ ] Connect and receive video frames
- [ ] Ignore audio deliberately
- [ ] Handle source disappearance and reappearance

## Phase 3 — Video presentation

- [ ] SDL2 fullscreen output
- [ ] Correct pixel format conversion
- [ ] Bounded frame queue and low-latency presentation
- [ ] 1920×1080 at 30 FPS target
- [ ] Clean display teardown and recovery

## Phase 4 — Reliability

- [ ] Frame-staleness detection
- [ ] Reconnect backoff
- [ ] State and health logging
- [ ] systemd unit and restart policy
- [ ] Configuration validation and safe defaults

## Phase 5 — Target-hardware validation

- [ ] Test on Mac mini Late 2014 / Debian 13
- [ ] Measure CPU, memory, dropped frames, and latency
- [ ] Test source loss/recovery
- [ ] Test LAN interruption/recovery
- [ ] Run a 24-hour playback test
- [ ] Document installation and recovery

## Engineering rules

1. Keep the receiver independent of internet access and remote services.
2. Keep the first version focused: receive, display, reconnect.
3. Never claim target-hardware performance until it has been measured on the actual Mac mini.
4. Keep NDI SDK acquisition separate from the source tree unless redistribution is explicitly permitted.
5. Prefer observable state transitions and bounded queues over hidden retries and unbounded buffering.
