#include "veyra/control_plane/client.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

std::string readRequest(const int clientSocket) {
    std::string request;
    char buffer[4096];
    std::size_t expectedBytes = 0;
    bool contentLengthRead = false;

    while (true) {
        const ssize_t received = ::recv(clientSocket, buffer, sizeof(buffer), 0);
        if (received <= 0) break;
        request.append(buffer, static_cast<std::size_t>(received));

        const auto headerEnd = request.find("\r\n\r\n");
        if (headerEnd != std::string::npos && !contentLengthRead) {
            const auto lengthStart = request.find("Content-Length:");
            if (lengthStart != std::string::npos) {
                const auto valueStart = lengthStart + std::strlen("Content-Length:");
                const auto valueEnd = request.find("\r\n", valueStart);
                expectedBytes = static_cast<std::size_t>(
                    std::stoul(request.substr(valueStart, valueEnd - valueStart))
                );
            }
            contentLengthRead = true;
        }

        if (contentLengthRead && headerEnd != std::string::npos &&
            request.size() >= headerEnd + 4 + expectedBytes) {
            break;
        }
    }
    return request;
}

bool sendAll(const int socket, const std::string& response) {
    std::size_t sent = 0;
    while (sent < response.size()) {
        const ssize_t count = ::send(
            socket,
            response.data() + sent,
            response.size() - sent,
            0
        );
        if (count <= 0) return false;
        sent += static_cast<std::size_t>(count);
    }
    return true;
}

}  // namespace

int main() {
    const int listener = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listener < 0) {
        std::cerr << "Could not create mock control-plane socket\n";
        return 1;
    }

    int reuseAddress = 1;
    ::setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuseAddress, sizeof(reuseAddress));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    if (::bind(listener, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
        ::listen(listener, 4) != 0) {
        std::cerr << "Could not bind mock control-plane socket\n";
        ::close(listener);
        return 1;
    }

    socklen_t addressLength = sizeof(address);
    if (::getsockname(listener, reinterpret_cast<sockaddr*>(&address), &addressLength) != 0) {
        std::cerr << "Could not read mock control-plane port\n";
        ::close(listener);
        return 1;
    }

    std::mutex requestsMutex;
    std::condition_variable requestsChanged;
    std::vector<std::string> requests;
    std::atomic_bool serverFailed{false};
    const std::string token(43, 't');

    std::thread mockServer([&] {
        for (int index = 0; index < 8; ++index) {
            pollfd descriptor{listener, POLLIN, 0};
            if (::poll(&descriptor, 1, 7000) <= 0) {
                serverFailed = true;
                break;
            }
            const int clientSocket = ::accept(listener, nullptr, nullptr);
            if (clientSocket < 0) {
                serverFailed = true;
                break;
            }

            const std::string request = readRequest(clientSocket);
            {
                std::lock_guard lock(requestsMutex);
                requests.push_back(request);
            }
            requestsChanged.notify_all();

            const std::string asset = "veyra-cache-test";
            const std::string assetHash = "260f2cc234c5ee0384d6bc4ff21bfbaac52f72b7a28ac97cbecb45c605075159";
            std::string responseBody;
            std::string contentType = "application/json";
            const int status = index == 0 ? 201 : index == 7 ? 404 : 200;
            const std::string reason = index == 0 ? "Created" : index == 7 ? "Not Found" : "OK";
            if (index == 0) {
                responseBody = "{\"deviceId\":\"device-test\",\"deviceToken\":\"" + token +
                    "\",\"heartbeatIntervalSeconds\":120}";
            } else if (index == 1) {
                responseBody = "{}";
            } else if (index == 2) {
                responseBody = "{\"schemaVersion\":1,\"configVersion\":2,\"ndi\":{\"sourceName\":\"Camera 1\",\"sourceAddress\":\"ndi://camera-1.local\"},\"fallbackPlaylistId\":\"fallback-1\"}";
            } else if (index == 3) {
                responseBody = "{\"schemaVersion\":1,\"configVersion\":2,\"playlistId\":\"fallback-1\",\"playlistRevision\":3,\"items\":[{\"mediaId\":\"media-1\",\"position\":0,\"durationSeconds\":12,\"mimeType\":\"image/png\",\"sizeBytes\":16,\"sha256\":\"" + assetHash + "\",\"downloadPath\":\"/api/v1/receiver/media/media-1\"}]}";
            } else if (index == 4) {
                responseBody = asset;
                contentType = "image/png";
            } else if (index == 5) {
                responseBody = "{\"schemaVersion\":1,\"configVersion\":3,\"ndi\":{\"sourceName\":\"Camera 2\",\"sourceAddress\":\"ndi://camera-2.local\"},\"fallbackPlaylistId\":\"fallback-1\"}";
            } else if (index == 6) {
                responseBody = "{\"schemaVersion\":1,\"configVersion\":3,\"playlistId\":\"fallback-1\",\"playlistRevision\":4,\"items\":[{\"mediaId\":\"media-2\",\"position\":0,\"durationSeconds\":20,\"mimeType\":\"image/png\",\"sizeBytes\":16,\"sha256\":\"260f2cc234c5ee0384d6bc4ff21bfbaac52f72b7a28ac97cbecb45c605075159\",\"downloadPath\":\"/api/v1/receiver/media/media-2\"}]}";
            } else {
                responseBody = "{\"error\":\"Assigned media item not found\"}";
            }
            const std::string response =
                "HTTP/1.1 " + std::to_string(status) + " " + reason + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + std::to_string(responseBody.size()) + "\r\n" +
                "Connection: close\r\n\r\n" + responseBody;
            if (!sendAll(clientSocket, response)) serverFailed = true;
            ::shutdown(clientSocket, SHUT_RDWR);
            ::close(clientSocket);
        }
    });

    const auto temporaryRoot = std::filesystem::temp_directory_path() /
        ("veyra-control-plane-test-" + std::to_string(static_cast<long long>(::getpid())));
    const auto credentialPath = temporaryRoot / "state" / "veyra" / "device-token";
    std::filesystem::remove_all(temporaryRoot);

    bool success = false;
    {
        veyra::config::ControlPlaneConfig config;
        config.serverUrl = "http://127.0.0.1:" + std::to_string(ntohs(address.sin_port));
        config.deviceName = "Test Display";
        config.pairingCode = "123456789012";
        config.credentialPath = credentialPath;
        config.heartbeatIntervalSeconds = 120;
        config.syncIntervalSeconds = 5;
        config.cachePath = temporaryRoot / "cache";

        veyra::control_plane::Client client(config);
        veyra::control_plane::PlaybackSnapshot snapshot;
        snapshot.mode = "ndi";
        snapshot.ndiSourceName = "Camera 1";
        snapshot.uptimeSeconds = 42;
        snapshot.ndiSources.push_back({"Camera 1", "ndi://camera-1.local"});
        client.updateStatus(std::move(snapshot));
        client.start();

        {
            std::unique_lock lock(requestsMutex);
            requestsChanged.wait_for(lock, std::chrono::seconds(15), [&] {
                return requests.size() >= 8 || serverFailed;
            });
        }

        client.stop();

        std::ifstream credentialFile(credentialPath);
        std::string storedToken;
        std::getline(credentialFile, storedToken);

        struct stat fileInfo {};
        struct stat directoryInfo {};
        const bool fileModeOk =
            ::stat(credentialPath.c_str(), &fileInfo) == 0 &&
            (fileInfo.st_mode & 0777) == 0600;
        const bool directoryModeOk =
            ::stat(credentialPath.parent_path().c_str(), &directoryInfo) == 0 &&
            (directoryInfo.st_mode & 0777) == 0700;

        std::lock_guard lock(requestsMutex);
        const bool pairRequestOk = requests.size() >= 1 &&
            requests[0].find("POST /api/v1/receiver/pair ") != std::string::npos &&
            requests[0].find("123456789012") != std::string::npos &&
            requests[0].find("Test Display") != std::string::npos;
        const bool heartbeatRequestOk = requests.size() >= 2 &&
            requests[1].find("POST /api/v1/receiver/heartbeat ") != std::string::npos &&
            requests[1].find("Authorization: Bearer " + token) != std::string::npos &&
            requests[1].find("Camera 1") != std::string::npos &&
            requests[1].find("\"playbackMode\":\"ndi\"") != std::string::npos;

        const bool configRequestOk = requests.size() >= 3 &&
            requests[2].find("GET /api/v1/receiver/config ") != std::string::npos;
        const bool manifestRequestOk = requests.size() >= 4 &&
            requests[3].find("GET /api/v1/receiver/media-manifest ") != std::string::npos;
        const bool assetRequestOk = requests.size() >= 5 &&
            requests[4].find("GET /api/v1/receiver/media/media-1 ") != std::string::npos;
        const bool failedUpdateAttempted = requests.size() >= 8 &&
            requests[5].find("GET /api/v1/receiver/config ") != std::string::npos &&
            requests[6].find("GET /api/v1/receiver/media-manifest ") != std::string::npos &&
            requests[7].find("GET /api/v1/receiver/media/media-2 ") != std::string::npos;
        const auto synced = client.syncSnapshot();
        std::ifstream stateInput(config.cachePath / "state.json");
        const std::string persistedState((std::istreambuf_iterator<char>(stateInput)), {});
        const bool previousSnapshotPreserved = synced.configVersion == 2 &&
            synced.fallbackItems.size() == 1 &&
            persistedState.find("\"configVersion\": 2") != std::string::npos;
        const auto reloaded = veyra::control_plane::ReceiverSync(config).loadCached();
        bool cachedAssetOk = false;
        bool cachePermissionsOk = false;
        if (synced.hasValidCachedState && synced.fallbackItems.size() == 1) {
            std::ifstream cached(synced.fallbackItems[0].path, std::ios::binary);
            const std::string bytes((std::istreambuf_iterator<char>(cached)), {});
            cachedAssetOk = bytes == "veyra-cache-test" &&
                synced.fallbackItems[0].durationSeconds == 12 &&
                synced.ndiSourceName == "Camera 1" &&
                reloaded.hasValidCachedState && reloaded.fallbackItems.size() == 1 &&
                reloaded.fallbackItems[0].sha256 == synced.fallbackItems[0].sha256;
            struct stat cacheDirectoryInfo{};
            struct stat mediaDirectoryInfo{};
            struct stat cacheFileInfo{};
            const auto mediaDirectory = config.cachePath / "media";
            cachePermissionsOk =
                ::stat(config.cachePath.c_str(), &cacheDirectoryInfo) == 0 &&
                ::stat(mediaDirectory.c_str(), &mediaDirectoryInfo) == 0 &&
                ::stat(synced.fallbackItems[0].path.c_str(), &cacheFileInfo) == 0 &&
                (cacheDirectoryInfo.st_mode & 0777) == 0700 &&
                (mediaDirectoryInfo.st_mode & 0777) == 0700 &&
                (cacheFileInfo.st_mode & 0777) == 0600;
        }

        bool corruptCacheRejected = false;
        if (synced.hasValidCachedState && synced.fallbackItems.size() == 1) {
            std::ofstream corrupt(synced.fallbackItems[0].path, std::ios::binary | std::ios::trunc);
            corrupt << "tampered-cache-data";
            corrupt.close();
            const auto damaged = veyra::control_plane::ReceiverSync(config).loadCached();
            corruptCacheRejected = damaged.hasValidCachedState && damaged.fallbackItems.empty();
        }

        success = !serverFailed && pairRequestOk && heartbeatRequestOk &&
            configRequestOk && manifestRequestOk && assetRequestOk && cachedAssetOk &&
            failedUpdateAttempted && previousSnapshotPreserved &&
            corruptCacheRejected && cachePermissionsOk &&
            storedToken == token && fileModeOk && directoryModeOk;
    }

    mockServer.join();
    ::close(listener);
    std::filesystem::remove_all(temporaryRoot);

    if (!success) {
        std::cerr << "Control-plane pairing, heartbeat, sync, cache integrity, or credential persistence test failed\n";
        return 1;
    }

    std::cout << "Control-plane pairing, verified media sync, and credential persistence test passed\n";
    return 0;
}
