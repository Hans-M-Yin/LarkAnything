import SwiftUI
import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if model?.busy == true {
            let alert = NSAlert(); alert.messageText = "正在处理内容"
            alert.informativeText = "请等待当前操作完成后再退出，避免中断上传与校验。"
            alert.addButton(withTitle: "继续等待"); alert.runModal()
            return .terminateCancel
        }
        return .terminateNow
    }
    func applicationWillTerminate(_ notification: Notification) { model?.client.stop() }
}

@main
@MainActor
struct LarkAnythingApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        Window("LarkAnything", id: "library") {
            LibraryView().environmentObject(model)
                .task { delegate.model = model; await model.bootstrap() }
        }
        .defaultSize(width: 900, height: 640)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("设置…") { openWindow(id: "settings") }.keyboardShortcut(",").disabled(model.busy)
            }
        }
        Window("设置", id: "settings") {
            SettingsView().environmentObject(model)
        }.defaultSize(width: 520, height: 520).windowResizability(.contentSize)
        MenuBarExtra("LarkAnything", systemImage: "square.and.arrow.up") {
            MenuPanel().environmentObject(model)
                .task { delegate.model = model; await model.bootstrap() }
        }.menuBarExtraStyle(.window)
    }
}

@MainActor
struct ErrorNotice: ViewModifier {
    @ObservedObject var model: AppModel
    func body(content: Content) -> some View {
        content.alert("操作未完成", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("好", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}

@MainActor
struct SourcePicker: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Picker("内容来源", selection: $model.source) {
            ForEach(Source.allCases) { source in Label(source.title, systemImage: source.symbol).tag(source) }
        }.pickerStyle(.segmented).labelsHidden().disabled(model.busy)
            .onChange(of: model.source) { _ in model.query = ""; Task { await model.refresh() } }
    }
}

@MainActor
struct ContentRow: View {
    let item: ContentItem
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(item.title).font(.headline).lineLimit(2)
            Text(item.error ?? item.excerpt ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            HStack {
                if let location = item.location { Text(URL(fileURLWithPath: location).lastPathComponent).lineLimit(1) }
                Spacer()
                if item.modified > 0 { Text(item.modifiedDate, format: .dateTime.month().day().hour().minute()) }
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 5).opacity(item.error == nil ? 1 : 0.6)
    }
}

@MainActor
struct LibraryView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                SourcePicker().padding()
                List(selection: Binding(get: { model.selectedID }, set: { id in
                    if let item = model.items.first(where: { $0.id == id }) { Task { await model.select(item) } }
                })) {
                    ForEach(model.filtered) { item in ContentRow(item: item).tag(item.id) }
                }.listStyle(.sidebar).disabled(model.busy)
                if model.items.isEmpty && !model.busy {
                    Text("没有找到内容。请在设置中选择数据目录。").font(.caption).foregroundStyle(.secondary).padding()
                }
                Text("\(model.filtered.count) 项 · 文件修改时间").font(.caption).foregroundStyle(.secondary).padding(10)
            }.navigationSplitViewColumnWidth(min: 270, ideal: 310, max: 400)
                .searchable(text: $model.query, prompt: "搜索标题、摘录或路径")
        } detail: {
            VStack(spacing: 0) {
                if let preview = model.preview {
                    DocumentPreview(html: preview.html)
                    Divider()
                    HStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("保存到飞书").font(.caption).foregroundStyle(.secondary)
                            Text(preview.target == "默认位置" ? "我的云盘 · 默认位置" : preview.target).lineLimit(1).textSelection(.enabled)
                        }
                        Spacer()
                        if model.receipt != nil {
                            Label("已校验", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                            if model.receipt?.remote?.url != nil { Button("打开文档") { model.openResult() } }
                        } else {
                            PublishButton(title: preview.action) { Task { await model.publish() } }.disabled(model.busy)
                        }
                    }.padding()
                } else {
                    VStack(spacing: 14) {
                        Image(systemName: "doc.text.magnifyingglass").font(.system(size: 40, weight: .light)).foregroundStyle(.secondary)
                        Text("选择要收藏的内容").font(.title2)
                        Text("预览会话或笔记，然后保存到飞书。").foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if model.busy { HStack { ProgressView().controlSize(.small); Text(model.status).font(.caption); Spacer() }.padding(12) }
            }.navigationTitle(model.preview?.title ?? "LarkAnything")
        }
        .toolbar {
            ToolbarItem { Button { Task { await model.refresh() } } label: { Label("刷新", systemImage: "arrow.clockwise") }.disabled(model.busy) }
            ToolbarItem { Button { openWindow(id: "settings") } label: { Label("设置", systemImage: "gearshape") }.disabled(model.busy) }
        }
        .frame(minWidth: 700, minHeight: 480)
        .modifier(ErrorNotice(model: model))
    }
}

@MainActor
struct PublishButton: View {
    let title: String
    let action: () -> Void
    @ViewBuilder var body: some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            Button(title, systemImage: "square.and.arrow.up", action: action).buttonStyle(.glassProminent)
        } else {
            Button(action: action) { Label(title, systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent)
        }
        #else
        Button(action: action) { Label(title, systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent)
        #endif
    }
}

@MainActor
struct MenuPanel: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(spacing: 12) {
            HStack { Text("LarkAnything").font(.headline); Spacer(); Button { openWindow(id: "settings"); NSApp.activate(ignoringOtherApps: true) } label: { Image(systemName: "gearshape") }.disabled(model.busy) }
            SourcePicker()
            TextField("搜索内容", text: $model.query).textFieldStyle(.roundedBorder)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(model.filtered.prefix(20)) { item in
                        Button {
                            openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true)
                            Task { await model.select(item) }
                        } label: { ContentRow(item: item).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()) }
                        .buttonStyle(.plain).disabled(model.busy || item.error != nil)
                        Divider()
                    }
                    if model.filtered.isEmpty { Text(model.busy ? "正在读取…" : "没有匹配的内容").foregroundStyle(.secondary).padding() }
                }
            }.frame(height: 280)
            if model.busy { HStack { ProgressView().controlSize(.small); Text(model.status).font(.caption) } }
            HStack {
                Button("打开资料库") { openWindow(id: "library"); NSApp.activate(ignoringOtherApps: true) }
                Spacer()
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }.disabled(model.busy)
                Button("退出") { NSApp.terminate(nil) }.disabled(model.busy)
            }
        }.padding(16).frame(width: 380).modifier(ErrorNotice(model: model))
    }
}
