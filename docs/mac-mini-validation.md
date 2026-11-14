# Mac mini receiver validation

This is the first-hardware checklist for the Late-2014 Mac mini target. It is deliberately a validation procedure, not a claim that the player has already been tested on that hardware.

## Target

- Apple Mac mini (Late 2014), Macmini7,1
- Intel Core i5-4278U, Intel Iris 5100, 8 GB RAM
- Debian 13 x86_64 with XFCE/X11
- Initial output target: 1920×1080 at 30 FPS
- Wired Ethernet strongly preferred

## 1. Verify the operating system and display

```bash
uname -a
cat /etc/os-release
lscpu
free -h
lspci -nnk | grep -A3 -E 'VGA|Display'
xrandr --query
```

Confirm that the Intel graphics driver is loaded and that the display exposes 1920×1080. Do not force a display mode until the monitor and cable are known to support it.

## 2. Install build and runtime dependencies

```bash
sudo apt update
sudo apt install --yes \
  build-essential cmake ninja-build pkg-config git \
  libsdl2-dev libspdlog-dev nlohmann-json3-dev \
  avahi-daemon curl ca-certificates
sudo systemctl enable --now avahi-daemon
```

Install the official NDI SDK for Linux separately, following its license and installation instructions. Do not commit SDK headers, libraries, or redistributable files to this repository unless the SDK license explicitly permits it.

Record the installed SDK version and installation directory. Keep the SDK directory path handy for CMake.

## 3. Get the Veyra source

```bash
git clone https://github.com/lucamoldovan/veyra.git
cd veyra
git rev-parse --short HEAD
```

Record the commit SHA used for the test so results can be tied to an exact build.

## 4. Run SDK-independent tests first

These tests do not need the NDI SDK or a display:

```bash
cmake -S . -B build-tests -G Ninja \
  -DVEYRA_BUILD_PLAYER=OFF \
  -DVEYRA_BUILD_TESTS=ON
cmake --build build-tests --parallel
ctest --test-dir build-tests --output-on-failure
```

Do not continue if these tests fail.

## 5. Build the complete receiver against the installed NDI SDK

```bash
cmake -S . -B build -G Ninja \
  -DVEYRA_BUILD_PLAYER=ON \
  -DVEYRA_BUILD_TESTS=ON \
  -DNDI_SDK_DIR=/absolute/path/to/ndi/sdk
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

If the build fails, save the complete CMake configure output and compiler output. Do not work around missing SDK symbols by guessing API names or changing SDK headers.

Check dynamic library resolution:

```bash
ldd ./build/veyra
```

There should be no `not found` entries.

## 6. Validate NDI discovery before fullscreen playback

Start a known NDI sender on the same wired LAN. Confirm both machines are on the same subnet and that multicast/discovery traffic is not blocked by the network.

```bash
./build/veyra --list-sources
```

Record the exact source name and address. Prefer the address in `config/veyra.example.json` and create a local configuration file. Do not commit site-specific source names or addresses.

## 7. Test playback in a controlled sequence

Start windowed or on a spare display first if the current configuration allows it. Then test:

1. Stable 1080p30 video for at least 30 minutes.
2. Source stop and restart.
3. Ethernet disconnect and reconnect.
4. Sender application restart.
5. Display sleep/wake and XFCE session restart.
6. Veyra process termination and systemd restart.
7. A sustained 24-hour run only after the shorter tests are clean.

For each test, record whether the image freezes, turns black, recovers automatically, or needs a process restart. Record CPU and memory usage:

```bash
top -H -p "$(pgrep -n veyra)"
ps -o pid,etime,%cpu,%mem,rss,cmd -C veyra
journalctl --user -u veyra.service --since "30 minutes ago"
```

Do not treat a visually smooth short test as proof of 24-hour stability.

## 8. Install the user service only after manual playback is stable

Follow the systemd user-service instructions in the root README. Confirm that the service runs inside the logged-in XFCE/X11 session and has the correct `DISPLAY` and `XAUTHORITY`.

```bash
systemctl --user status veyra.service
journalctl --user -u veyra.service -f
```

The initial deployment depends on an active graphical session. Unattended startup therefore requires a deliberate display-manager/autologin configuration.

## 9. Server and receiver pairing status

The server can issue one-time pairing codes, register devices, and accept authenticated heartbeats. The native C++ receiver does not yet implement the pairing or heartbeat client, certificate trust configuration, or credential storage.

Until those pieces are implemented and tested, do not expose the server on the LAN for receiver enrollment. Keep the server on its default loopback address. The non-loopback TLS guard is intentional; do not disable it or send bearer credentials over plaintext HTTP.

## Test report template

Record the following in an issue or test note:

- Test date and Veyra commit SHA
- Debian release and kernel version
- NDI SDK version
- Display model, resolution, and refresh rate
- Sender software and video format
- Wired/wireless network details
- Build result and complete compiler output if it failed
- Playback duration and any interruptions
- CPU, memory, and dropped-frame observations
- Source-loss and recovery behavior
- Logs for every failure
- Final result: pass, fail, or needs investigation
