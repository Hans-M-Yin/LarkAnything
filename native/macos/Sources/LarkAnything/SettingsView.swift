import SwiftUI
import AppKit

@MainActor
struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = UserSettings()
    var body: some View {
        Form {
            Section("飞书") {
                TextField("保存位置", text: $draft.parentToken, prompt: Text("文件夹链接或 Token，留空使用默认位置"))
                PathField(title: "飞书 CLI", value: $draft.executable, directory: false)
                Text("复用已安装的官方 CLI 与授权。首次连接请按项目安装指南完成授权。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("内容来源") {
                PathField(title: "Obsidian 仓库", value: optional(\UserSettings.vault), directory: true)
                PathField(title: "Codex 数据目录", value: optional(\UserSettings.codexHome), directory: true)
                PathField(title: "Claude 数据目录", value: optional(\UserSettings.claudeHome), directory: true)
                Text("数据目录留空时，Codex 使用 ~/.codex，Claude Code 使用 ~/.claude。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("导出") {
                Toggle("包含工具日志", isOn: $draft.includeTools)
                Text("对话追加新增消息；笔记修改后创建新文档。附件与 Obsidian 嵌入尚未上传。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack { Spacer(); Button("取消") { dismiss() }; Button("保存") {
                Task { if await model.save(draft) { dismiss() } }
            }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction) }
        }.formStyle(.grouped).padding(12).frame(width: 560, height: 560)
            .disabled(model.busy).onAppear { draft = model.settings }
            .modifier(ErrorNotice(model: model))
    }
    private func optional(_ path: WritableKeyPath<UserSettings, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: path] ?? "" }, set: { draft[keyPath: path] = $0 })
    }
}

@MainActor
struct PathField: View {
    let title: String
    @Binding var value: String
    let directory: Bool
    var body: some View {
        HStack {
            TextField(title, text: $value)
            Button("选择…") {
                let panel = NSOpenPanel()
                panel.canChooseDirectories = directory; panel.canChooseFiles = !directory
                panel.allowsMultipleSelection = false
                panel.showsHiddenFiles = true
                panel.prompt = "选择"
                if panel.runModal() == .OK, let url = panel.url { value = url.path }
            }
        }
    }
}
