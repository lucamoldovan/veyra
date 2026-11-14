#pragma once

#include "veyra/ndi/discovery.hpp"

#include <Processing.NDI.Lib.h>

#include <cstdint>
#include <optional>
#include <vector>

namespace veyra::ndi {

enum class PixelFormat {
    UYVY,
    BGRA
};

struct VideoFrame {
    int width{0};
    int height{0};
    int stride{0};
    PixelFormat format{PixelFormat::UYVY};
    std::vector<std::uint8_t> pixels;
};

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
};

}  // namespace veyra::ndi
