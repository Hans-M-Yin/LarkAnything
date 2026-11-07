import Foundation
import AppKit
import SwiftUI

enum Source: String, CaseIterable, Identifiable {
    case codex, claude = "claude-code", obsidian
    var id: String { rawValue }
    var title: String { switch self { case .codex: return "Codex"; case .claude: return "Claude Code"; case .obsidian: return "Obsidian" } }
    var symbol: String { switch self { case .codex: return "terminal"; case .claude: return "text.bubble"; case .obsidian: return "doc.text" } }
}
struct ContentItem: Decodable, Identifiable {
    let id: String
    let title: String
    let excerpt: String?
    let location: String?
    let modified: Double
    let count: Int?
    let error: String?
    var modifiedDate: Date { Date(timeIntervalSince1970: modified / 1000) }
}
struct Preview: Decodable {
    let token: String
    let title: String
    let html: String
    let operation: String
    let target: String
    var action: String { switch operation { case "append": return "同步新增消息"; case "unchanged": return "查看已发布文档"; default: return "上传到飞书" } }
}
struct UserSettings: Codable {
    var parentToken = ""
    var includeTools = false
    var executable = "lark-cli"
    var vault: String?
    var codexHome: String?
    var claudeHome: String?
}
struct Receipt: Decodable {
    struct Remote: Decodable { let url: String? }
    let status: String
    let remote: Remote?
}

@MainActor
final class AppModel: ObservableObject {
    let client = CoreClient()
    @Published var source: Source = .codex
    @Published var query = ""
    @Published var items: [ContentItem] = []
    @Published var selectedID: String?
    @Published var preview: Preview?
    @Published var settings = UserSettings()
    @Published var busy = false
    @Published var status = ""
    @Published var error: String?
    @Published var receipt: Receipt?
    private var started = false

    var filtered: [ContentItem] {
        if query.isEmpty { return items }
        return items.filter { [$0.title, $0.excerpt ?? "", $0.location ?? ""].joined(separator: " ").localizedCaseInsensitiveContains(query) }
    }
    func bootstrap() async {
        guard !started else { return }; started = true
        busy = true
        do { settings = try await client.call("settings", as: UserSettings.self) }
        catch { self.error = error.localizedDescription }
        busy = false
        await refresh()
    }
    func refresh() async {
        guard !busy else { return }; busy = true; status = "正在读取本地内容…"
        defer { busy = false; status = "" }
        preview = nil; receipt = nil; selectedID = nil; items = []
        do { items = try await client.call("list", params: ["channel": source.rawValue], as: [ContentItem].self) }
        catch { self.error = error.localizedDescription }
    }
    func select(_ item: ContentItem) async {
        guard !busy, item.error == nil else { return }
        busy = true; status = "正在准备内容快照…"; selectedID = item.id; preview = nil; receipt = nil
        defer { busy = false; status = "" }
        do { preview = try await client.call("preview", params: ["id": item.id], as: Preview.self) }
        catch { self.error = error.localizedDescription }
    }
    func publish() async {
        guard !busy, let preview else { return }
        busy = true; status = "正在上传并回读校验…"
        defer { busy = false; status = "" }
        do { receipt = try await client.call("publish", params: ["token": preview.token], as: Receipt.self) }
        catch { self.error = error.localizedDescription }
    }
    func save(_ draft: UserSettings) async -> Bool {
        guard !busy else { return false }; busy = true
        do {
            let data = try JSONEncoder().encode(draft)
            let object = try JSONSerialization.jsonObject(with: data)
            settings = try await client.call("saveSettings", params: ["settings": object], as: UserSettings.self)
            busy = false; await refresh(); return true
        } catch { busy = false; self.error = error.localizedDescription; return false }
    }
    func openResult() {
        guard let text = receipt?.remote?.url, let url = URL(string: text), url.scheme == "https", url.user == nil, url.password == nil,
              let host = url.host, ["feishu.cn", "larksuite.com"].contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return }
        NSWorkspace.shared.open(url)
    }
}
