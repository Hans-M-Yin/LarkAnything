import SwiftUI
import WebKit

// The document renderer stays shared. Navigation, lists and settings are native.
@MainActor
struct DocumentPreview: NSViewRepresentable {
    let html: String
    @Environment(\.colorScheme) private var colorScheme
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        let dark = colorScheme == .dark
        let style = dark ? "html,body{background:#1e1e1e!important;color:#e6e6e6!important}article{background:#252525!important;border-color:#444!important}h1,h2,h3,h4{color:#eee!important}pre,blockquote,code,th{background:#303030!important;color:#ddd!important}a{color:#9bbdf5!important}" : "html,body{background:#fff!important;color:#252525!important}"
        let content = html.replacingOccurrences(of: "</style>", with: style + "</style>")
        guard context.coordinator.lastHTML != content else { return }
        context.coordinator.lastHTML = content
        view.loadHTMLString(content, baseURL: nil)
    }
    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastHTML = ""
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // The only allowed navigation is the in-memory preview itself.
            let allowed = action.navigationType == .other && action.request.url?.absoluteString == "about:blank"
            decisionHandler(allowed ? .allow : .cancel)
        }
    }
}
