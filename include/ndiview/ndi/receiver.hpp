#pragma once

#include "ndiview/ndi/discovery.hpp"
#include "ndiview/video/frame.hpp"

#include <cstdint>
#include <optional>
#include <vector>

namespace ndiview::ndi {

using PixelFormat = ndiview::video::PixelFormat;
using VideoFrame = ndiview::video::VideoFrame;

class Receiver {
public:
    explicit Receiver(Source source);
    ~Receiver();

    Receiver(const Receiver&) = delete;
    Receiver& operator=(const Receiver&) = delete;

    Receiver(Receiver&&) = delete;
    Receiver& operator=(Receiver&&) = delete;

    [[nodiscard]] bool isConnected() const;
    [[nodiscard]] std::optional<VideoFrame> capture(std::uint32_t timeoutMs);

private:
    Source source_;
    NDIlib_recv_instance_t instance_{nullptr};
    bool unsupportedFormatLogged_{false};
};

}  // namespace ndiview::ndi
