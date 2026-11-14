#include "veyra/control_plane/client.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
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

    std::atomic_int configRequestCount{0};
    std::atomic_int manifestRequestCount{0};
    std::atomic_bool failedMediaRequestSeen{false};
    std::thread mockServer([&] {
        for (int index = 0; index < 10; ++index) {
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
            int status = 200;
            std::string reason = "OK";

            if (request.find("POST /api/v1/receiver/pair ") != std::string::npos) {
                status = 201;
                reason = "Created";
                responseBody = "{\"deviceId\":\"device-test\",\"deviceToken\":\"" + token +
                    "\",\"heartbeatIntervalSeconds\":120}";
            } else if (request.find("POST /api/v1/receiver/heartbeat ") != std::string::npos) {
                responseBody = "{}";
            } else if (request.find("GET /api/v1/receiver/config ") != std::string::npos) {
                const int version = ++configRequestCount == 1 ? 2 : 3;
                const std::string sourceName = version == 2 ? "Camera 1" : "Camera 2";
                const std::string sourceAddress = version == 2
                    ? "ndi://camera-1.local" : "ndi://camera-2.local";
                responseBody = "{\"schemaVersion\":1,\"configVersion\":" +
                    std::to_string(version) + ",\"ndi\":{\"sourceName\":\"" +
                    sourceName + "\",\"sourceAddress\":\"" + sourceAddress +
                    "\"},\"fallbackPlaylistId\":\"fallback-1\"}";
            } else if (request.find("GET /api/v1/receiver/media-manifest ") != std::string::npos) {
                const int revision = ++manifestRequestCount == 1 ? 3 : 4;
                const int version = revision == 3 ? 2 : 3;
                const std::string mediaId = revision == 3 ? "media-1" : "media-2";
                const std::string mediaHash = revision == 3 ? assetHash
                    : "360f2cc234c5ee0384d6bc4ff21bfbaac52f72b7a28ac97cbecb45c605075159";
                responseBody = "{\"schemaVersion\":1,\"configVersion\":" +
                    std::to_string(version) + ",\"playlistId\":\"fallback-1\",\"playlistRevision\":" +
                    std::to_string(revision) + ",\"items\":[{\"mediaId\":\"" + mediaId +
                    "\",\"position\":0,\"durationSeconds\":12,\"mimeType\":\"image/png\",\"sizeBytes\":16,\"sha256\":\"" +
                    assetHash + "\",\"downloadPath\":\"/api/v1/receiver/media/" + mediaId + "\"}]}";
            } else if (request.find("GET /api/v1/receiver/media/media-1 ") != std::string::npos) {
                responseBody = asset;
                contentType = "image/png";
            } else if (request.find("GET /api/v1/receiver/media/media-2 ") != std::string::npos) {
                status = 404;
                reason = "Not Found";
                responseBody = "{\"error\":\"Assigned media item not found\"}";
                failedMediaRequestSeen = true;
            } else {
                status = 404;
                reason = "Not Found";
                responseBody = "{\"error\":\"Unexpected mock request\"}";
                serverFailed = true;
            }

            const std::string response =
                "HTTP/1.1 " + std::to_string(status) + " " + reason + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + std::to_string(responseBody.size()) + "\r\n" +
                "Connection: close\r\n\r\n" + responseBody;
            if (!sendAll(clientSocket, response)) serverFailed = true;
            ::shutdown(clientSocket, SHUT_RDWR);
            ::close(clientSocket);
            if (failedMediaRequestSeen.load()) break;
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
            requestsChanged.wait_for(lock, std::chrono::seconds(20), [&] {
                return failedMediaRequestSeen.load() || serverFailed;
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
        const auto hasRequest = [&](const std::string& fragment) {
            return std::any_of(requests.begin(), requests.end(), [&](const std::string& request) {
                return request.find(fragment) != std::string::npos;
            });
        };
        const bool pairRequestOk = hasRequest("POST /api/v1/receiver/pair ") &&
            hasRequest("123456789012") && hasRequest("Test Display");
        const bool heartbeatRequestOk = hasRequest("POST /api/v1/receiver/heartbeat ") &&
            hasRequest("Authorization: Bearer " + token) &&
            hasRequest("Camera 1") && hasRequest("\"playbackMode\":\"ndi\"");
        const bool configRequestOk = configRequestCount.load() >= 2;
        const bool manifestRequestOk = manifestRequestCount.load() >= 2;
        const bool assetRequestOk = hasRequest("GET /api/v1/receiver/media/media-1 ");
        const bool failedUpdateAttempted = failedMediaRequestSeen.load() &&
            hasRequest("GET /api/v1/receiver/media/media-2 ");
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
