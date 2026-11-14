# Development plan

## Phase 1 — Build foundation

- [x] C++20 project and CMake configuration
- [x] Dependency discovery for SDL2, spdlog, nlohmann/json, and the NDI SDK
- [x] Configuration loading and validation
- [x] Structured logging
- [x] Clean startup/shutdown path
- [x] SDK-independent configuration tests in GitHub Actions

## Phase 2 — NDI discovery and receiving

- [x] Initialize and shut down the NDI runtime safely
- [x] Discover sources on the local network
- [x] Copy source names and addresses before the finder updates its list
- [x] Select a source by configured address or exact name
- [x] Connect and receive video frames
- [x] Ignore audio and metadata deliberately
- [x] Keep the receiver alive to use the SDK's automatic reconnect behavior
- [ ] Validate source disappearance and reappearance with a real NDI sender

## Phase 3 — Video presentation

- [x] SDL2 fullscreen output
- [x] UYVY and BGRA frame handling
- [x] UYVY-to-BGRA fallback when the SDL renderer cannot use UYVY
- [x] Bounded latest-frame slot between capture and rendering
- [x] Preserve source aspect ratio
- [ ] Measure 1920×1080 at 30 FPS on the target Mac mini
- [ ] Validate display recovery after renderer/device reset on target hardware

## Phase 4 — Reliability

- [x] Frame-staleness detection and black-screen fallback
- [x] Cooperative capture-thread shutdown
- [x] State and health logging for discovery/playback transitions
- [ ] Verify NDI SDK reconnect timing and behavior during LAN interruption
- [ ] Add and validate the systemd user service for unattended startup
- [x] Configuration validation and safe defaults

## Phase 5 — Target-hardware validation

- [ ] Build against the official NDI SDK on Debian 13
- [ ] Test on Mac mini Late 2014
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
5. Prefer observable state transitions and bounded buffering over hidden retries and unbounded queues.
6. Review every code change and run the available checks before moving to the next task.
