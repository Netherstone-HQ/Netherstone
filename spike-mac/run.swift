// Throwaway spike: loads the spike page in a WKWebView and prints its report.
import AppKit
import WebKit

final class Delegate: NSObject, WKUIDelegate {
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let config = WKWebViewConfiguration()
config.mediaTypesRequiringUserActionForPlayback = []
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
let view = WKWebView(frame: window.contentView!.bounds, configuration: config)
let delegate = Delegate()
view.uiDelegate = delegate
window.contentView = view
window.makeKeyAndOrderFront(nil)
let seconds = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "5"
view.load(URLRequest(url: URL(string: "http://localhost:8765/mic-spike.html?seconds=\(seconds)")!))
let deadline = Date().addingTimeInterval(240)
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    view.evaluateJavaScript("window.__spikeReport || ''") { result, _ in
        if let text = result as? String, !text.isEmpty {
            print(text)
            exit(0)
        }
        if Date() > deadline {
            view.evaluateJavaScript("document.getElementById('log').textContent") { log, _ in
                print("TIMEOUT", log ?? "")
                exit(1)
            }
        }
    }
}
app.run()
