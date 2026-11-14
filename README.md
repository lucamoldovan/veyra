# Veyra

**Network video. Simplified.**

Veyra is a lightweight, Linux-based NDI receiver designed to turn a small computer into a reliable, unattended video display.

The first target is the Apple Mac mini (Late 2014) running Debian 13, outputting 1920×1080 at 30 FPS. Veyra is video-only: NDI audio is intentionally ignored.

## Goals

- Discover NDI sources available on the local network.
- Select and receive a source, then render it fullscreen.
- Detect source loss and reconnect automatically.
- Start on boot and recover from application failures.
- Keep playback independent of any cloud service or central server.
- Keep the receiver small, predictable, and easy to deploy.

## Initial technology

- C++20
- Official NDI SDK
- SDL2 for display and rendering
- CMake
- nlohmann/json for local configuration
- spdlog for structured logging
- systemd for process supervision on Linux

## Current status

The repository is at the project-foundation stage. Hardware playback and NDI performance have not yet been validated on the target Mac mini.

## Documentation

- [Architecture](docs/architecture.md)
- [Development plan](docs/development.md)

## Licensing

NDI SDK usage and redistribution must follow the current NDI SDK license. Veyra's own license will be selected before public distribution.
