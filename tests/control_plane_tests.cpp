#include "veyra/control_plane/client.hpp"

#include <iostream>

int main() {
    veyra::config::ControlPlaneConfig config;
    veyra::control_plane::Client client(config);

    veyra::control_plane::PlaybackSnapshot status;
    status.mode = "idle";
    status.uptimeSeconds = 1;
    client.updateStatus(std::move(status));
    client.start();
    client.stop();

    std::cout << "Control-plane disabled-mode test passed\n";
    return 0;
}
