import Foundation

struct CoreFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class CoreClient {
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var diagnostics: Pipe?
    private var buffer = Data()
    private var nextID = 0
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]

    private func start() throws {
        if process?.isRunning == true { return }
        guard let resources = Bundle.main.resourceURL else { throw CoreFailure(message: "应用资源目录不可用。") }
        let node = resources.appendingPathComponent("runtime/node")
        let bridge = resources.appendingPathComponent("core/native/bridge.mjs")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: bridge.path) else {
            throw CoreFailure(message: "应用缺少 Core 或 Node 运行时，请使用 native:build 生成完整 .app。")
        }
        let child = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        child.executableURL = node
        child.arguments = [bridge.path]
        child.currentDirectoryURL = resources.appendingPathComponent("core")
        var environment = ProcessInfo.processInfo.environment
        for key in ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"] { environment.removeValue(forKey: key) }
        // Finder does not inherit a shell's Homebrew PATH.
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        child.environment = environment
        child.standardInput = stdin; child.standardOutput = stdout; child.standardError = stderr
        buffer = Data()
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            DispatchQueue.main.async { self?.receive(chunk) }
        }
        // Drain stderr without forwarding arbitrary child output into the UI.
        stderr.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        child.terminationHandler = { [weak self] child in
            DispatchQueue.main.async {
                guard let self, self.process === child else { return }
                self.failAll("Core 已退出。请重新操作；若上传被中断，请先检查飞书文档。")
                self.clearHandles()
            }
        }
        process = child; input = stdin; output = stdout; diagnostics = stderr
        do { try child.run() } catch { clearHandles(); throw error }
    }

    func call<T: Decodable>(_ method: String, params: [String: Any] = [:], as type: T.Type) async throws -> T {
        try start()
        nextID += 1
        let id = nextID
        var data = try JSONSerialization.data(withJSONObject: ["version": 1, "id": id, "method": method, "params": params])
        data.append(10)
        let response: Data = try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            do { try input?.fileHandleForWriting.write(contentsOf: data) }
            catch { pending.removeValue(forKey: id)?.resume(throwing: error) }
        }
        return try JSONDecoder().decode(type, from: response)
    }

    private func receive(_ data: Data) {
        guard !data.isEmpty else { return }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
            do {
                guard let object = try JSONSerialization.jsonObject(with: line) as? [String: Any],
                      let id = object["id"] as? Int, object["version"] as? Int == 1 else {
                    throw CoreFailure(message: "Core 返回了无效响应。")
                }
                guard let continuation = pending.removeValue(forKey: id) else { continue }
                if object["ok"] as? Bool == true {
                    do { continuation.resume(returning: try JSONSerialization.data(withJSONObject: object["value"] ?? NSNull(), options: [.fragmentsAllowed])) }
                    catch { continuation.resume(throwing: error) }
                } else {
                    let error = object["error"] as? [String: Any]
                    continuation.resume(throwing: CoreFailure(message: error?["message"] as? String ?? "Core 操作失败。"))
                }
            } catch { failAll(error.localizedDescription) }
        }
    }

    private func failAll(_ message: String) {
        let callbacks = pending.values; pending.removeAll()
        for continuation in callbacks { continuation.resume(throwing: CoreFailure(message: message)) }
    }
    private func clearHandles() {
        output?.fileHandleForReading.readabilityHandler = nil
        diagnostics?.fileHandleForReading.readabilityHandler = nil
        input = nil; output = nil; diagnostics = nil; process = nil
    }
    func stop() {
        failAll("应用正在退出。")
        try? input?.fileHandleForWriting.close()
        process?.terminate()
        clearHandles()
    }
}
