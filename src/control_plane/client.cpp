#include "veyra/control_plane/client.hpp"

#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cctype>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <stdexcept>
#include <string_view>
#include <sys/stat.h>
#include <unistd.h>

namespace veyra::control_plane {
namespace {

using Json = nlohmann::json;
constexpr std::size_t kMaximumResponseBytes = 1024 * 1024;

std::size_t appendResponse(
    const char* data,
    const std::size_t size,
    const std::size_t count,
    void* userData
) {
    const std::size_t bytes = size * count;
    auto* response = static_cast<std::string*>(userData);
    if (bytes > kMaximumResponseBytes - response->size()) {
        return 0;
    }
    response->append(data, bytes);
    return bytes;
}

std::string platformName() {
#if defined(__x86_64__)
    return "linux-x86_64";
#elif defined(__aarch64__)
    return "linux-aarch64";
#elif defined(__APPLE__)
    return "macos";
#else
    return "linux-unknown";
#endif
}

std::string trim(std::string value) {
    while (!value.empty() &&
           std::isspace(static_cast<unsigned char>(value.back())) != 0) {
        value.pop_back();
    }
    const auto first = std::find_if(
        value.begin(),
        value.end(),
        [](unsigned char character) { return std::isspace(character) == 0; }
    );
    value.erase(value.begin(), first);
    return value;
}

}  // namespace

Client::Client(config::ControlPlaneConfig config)
    : config_(std::move(config)),
      heartbeatIntervalSeconds_(config_.heartbeatIntervalSeconds),
      startedAt_(std::chrono::steady_clock::now()) {
    if (config_.serverUrl.empty()) {
        return;
    }
    const CURLcode result = curl_global_init(CURL_GLOBAL_DEFAULT);
    if (result != CURLE_OK) {
        throw std::runtime_error("Could not initialize the control-plane HTTP client");
    }
}

Client::~Client() {
    stop();
    if (!config_.serverUrl.empty()) {
        curl_global_cleanup();
    }
}

void Client::start() {
    if (config_.serverUrl.empty() || started_.exchange(true)) {
        return;
    }
    worker_ = std::jthread([this](const std::stop_token stopToken) {
        run(stopToken);
    });
}

void Client::stop() {
    if (worker_.joinable()) {
        worker_.request_stop();
        worker_.join();
    }
}

void Client::updateStatus(PlaybackSnapshot snapshot) {
    std::lock_guard lock(snapshotMutex_);
    snapshot_ = std::move(snapshot);
}

void Client::run(const std::stop_token stopToken) {
    try {
        deviceToken_ = loadCredential();
    } catch (const std::exception& error) {
        spdlog::error("Veyra device credential could not be loaded: {}", error.what());
        return;
    }

    if (deviceToken_.empty() && config_.pairingCode.empty()) {
        spdlog::info("Veyra control plane is configured but no pairing code or device credential is available");
        return;
    }

    std::chrono::seconds retryDelay{5};
    while (!stopToken.stop_requested()) {
        if (deviceToken_.empty()) {
            if (!pair()) {
                waitFor(stopToken, retryDelay);
                retryDelay = std::min(retryDelay * 2, std::chrono::seconds{60});
                continue;
            }
            retryDelay = std::chrono::seconds{5};
        }

        if (sendHeartbeat()) {
            retryDelay = std::chrono::seconds{5};
            waitFor(stopToken, std::chrono::seconds{heartbeatIntervalSeconds_});
        } else {
            waitFor(stopToken, retryDelay);
            retryDelay = std::min(retryDelay * 2, std::chrono::seconds{60});
        }
    }
}

bool Client::pair() {
    Json body = {
        {"code", config_.pairingCode},
        {"deviceName", config_.deviceName},
        {"platform", platformName()},
        {"version", "0.1.0"},
    };
    const auto response = postJson("/api/v1/receiver/pair", body.dump());
    if (response.status != 201) {
        if (!response.error.empty()) {
            spdlog::warn("Veyra receiver pairing request failed: {}", response.error);
        } else {
            spdlog::warn("Veyra receiver pairing was rejected (HTTP {})", response.status);
        }
        return false;
    }

    try {
        const Json result = Json::parse(response.body);
        const std::string token = result.at("deviceToken").get<std::string>();
        const std::string id = result.at("deviceId").get<std::string>();
        if (token.size() < 32 || token.size() > 512 || id.empty()) {
            spdlog::error("Veyra server returned an invalid receiver credential");
            return false;
        }

        storeCredential(token);
        deviceToken_ = token;
        deviceId_ = id;
        if (result.contains("heartbeatIntervalSeconds") &&
            result.at("heartbeatIntervalSeconds").is_number_integer()) {
            const int interval = result.at("heartbeatIntervalSeconds").get<int>();
            if (interval >= 5 && interval <= 120) {
                heartbeatIntervalSeconds_ = interval;
            }
        }
        spdlog::info("Veyra receiver paired successfully (device ID {})", deviceId_);
        return true;
    } catch (const std::exception& error) {
        spdlog::error("Veyra pairing response was invalid: {}", error.what());
        return false;
    }
}

bool Client::sendHeartbeat() {
    PlaybackSnapshot snapshot;
    {
        std::lock_guard lock(snapshotMutex_);
        snapshot = snapshot_;
    }

    Json sources = Json::array();
    for (const auto& source : snapshot.ndiSources) {
        if (source.name.empty()) continue;
        sources.push_back({
            {"name", source.name},
            {"url", source.url},
        });
    }

    const auto uptime = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::steady_clock::now() - startedAt_
    ).count();

    Json body = {
        {"version", "0.1.0"},
        {"platform", platformName()},
        {"uptimeSeconds", std::max<std::int64_t>(0, uptime)},
        {"playbackMode", snapshot.mode},
        {"ndiSourceName", snapshot.ndiSourceName.empty()
            ? Json(nullptr)
            : Json(snapshot.ndiSourceName)},
        {"ndiSources", std::move(sources)},
    };

    const auto response = postJson(
        "/api/v1/receiver/heartbeat",
        body.dump(),
        deviceToken_
    );
    if (response.status == 200) {
        return true;
    }
    if (response.status == 401) {
        spdlog::error(
            "Veyra receiver credential was rejected. Revoke/remove this device, "
            "then clear the local credential and pair it again."
        );
    } else if (!response.error.empty()) {
        spdlog::warn("Veyra heartbeat failed: {}", response.error);
    } else {
        spdlog::warn("Veyra heartbeat was rejected (HTTP {})", response.status);
    }
    return false;
}

Client::HttpResponse Client::postJson(
    const std::string& path,
    const std::string& body,
    const std::string& bearerToken
) {
    HttpResponse response;
    CURL* handle = curl_easy_init();
    if (handle == nullptr) {
        response.error = "could not create HTTP request";
        return response;
    }

    const std::string url = config_.serverUrl + path;
    std::array<char, CURL_ERROR_SIZE> errorBuffer{};
    curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Accept: application/json");
    const std::string authorization = bearerToken.empty()
        ? std::string{}
        : "Authorization: Bearer " + bearerToken;
    if (!authorization.empty()) {
        headers = curl_slist_append(headers, authorization.c_str());
    }

    curl_easy_setopt(handle, CURLOPT_URL, url.c_str());
    curl_easy_setopt(handle, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(handle, CURLOPT_POST, 1L);
    curl_easy_setopt(handle, CURLOPT_POSTFIELDS, body.data());
    curl_easy_setopt(handle, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(body.size()));
    curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, appendResponse);
    curl_easy_setopt(handle, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(handle, CURLOPT_ERRORBUFFER, errorBuffer.data());
    curl_easy_setopt(handle, CURLOPT_CONNECTTIMEOUT_MS, 3000L);
    curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, 5000L);
    curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(handle, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(handle, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(handle, CURLOPT_USERAGENT, "Veyra/0.1.0");
    const std::string caCertificatePath = config_.caCertificatePath.string();
    if (!caCertificatePath.empty()) {
        curl_easy_setopt(handle, CURLOPT_CAINFO, caCertificatePath.c_str());
    }

    const CURLcode result = curl_easy_perform(handle);
    if (result == CURLE_OK) {
        curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &response.status);
    } else {
        response.error = errorBuffer[0] == '\0'
            ? curl_easy_strerror(result)
            : errorBuffer.data();
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(handle);
    return response;
}

std::string Client::loadCredential() const {
    if (!std::filesystem::exists(config_.credentialPath)) {
        return {};
    }

    struct stat info {};
    if (::lstat(config_.credentialPath.c_str(), &info) != 0 || !S_ISREG(info.st_mode)) {
        throw std::runtime_error("credential path must be a regular file, not a symlink");
    }
    if (::chmod(config_.credentialPath.c_str(), S_IRUSR | S_IWUSR) != 0) {
        throw std::runtime_error("could not restrict device credential file permissions");
    }

    std::ifstream input(config_.credentialPath);
    if (!input) {
        throw std::runtime_error("could not open device credential file");
    }
    std::string token;
    std::getline(input, token);
    token = trim(std::move(token));
    if (!token.empty() && (token.size() < 32 || token.size() > 512)) {
        throw std::runtime_error("device credential file contains an invalid token");
    }
    return token;
}

void Client::storeCredential(const std::string& token) const {
    const auto parent = config_.credentialPath.parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent);
        if (::chmod(parent.c_str(), S_IRWXU) != 0) {
            throw std::runtime_error("could not restrict device credential directory permissions");
        }
    }

    const auto temporaryPath = config_.credentialPath.string() +
        ".tmp-" + std::to_string(static_cast<long long>(::getpid()));
    const int descriptor = ::open(
        temporaryPath.c_str(),
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
        S_IRUSR | S_IWUSR
    );
    if (descriptor < 0) {
        throw std::runtime_error("could not create temporary device credential file");
    }

    const std::string content = token + "\n";
    std::size_t written = 0;
    bool success = true;
    while (written < content.size()) {
        const ssize_t count = ::write(
            descriptor,
            content.data() + written,
            content.size() - written
        );
        if (count <= 0) {
            success = false;
            break;
        }
        written += static_cast<std::size_t>(count);
    }
    if (success && ::fsync(descriptor) != 0) success = false;
    if (::close(descriptor) != 0) success = false;

    if (!success || ::rename(temporaryPath.c_str(), config_.credentialPath.c_str()) != 0) {
        ::unlink(temporaryPath.c_str());
        throw std::runtime_error("could not safely store device credential");
    }
    if (::chmod(config_.credentialPath.c_str(), S_IRUSR | S_IWUSR) != 0) {
        throw std::runtime_error("could not restrict device credential file permissions");
    }
}

void Client::waitFor(
    const std::stop_token stopToken,
    const std::chrono::seconds duration
) const {
    const auto deadline = std::chrono::steady_clock::now() + duration;
    while (!stopToken.stop_requested() && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

}  // namespace veyra::control_plane
