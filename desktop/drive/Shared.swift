import FileProvider
import Foundation

// Cloud as a drive in the Finder: what the app and its File Provider extension share.
// One place in the Finder for the account; at its top a folder per workspace it is in (the
// extension asks the server which). The app says who is signed in where when it sets the drive,
// in the drive's own `userInfo` – the system keeps it and hands it to the extension (sandboxed, started whenever
// the Finder needs it). No app group between them: macOS grants one only with a provisioning
// profile, and nothing else needs sharing.

struct DriveConfig {
  /** The server's origin, as the app signed in to it. */
  var server: String
  /** The account's session there. */
  var token: String

  var userInfo: [AnyHashable: Any] { ["server": server, "token": token] }

  init(server: String, token: String) {
    self.server = server
    self.token = token
  }

  init?(_ domain: NSFileProviderDomain) {
    guard let info = domain.userInfo, let server = info["server"] as? String,
      let token = info["token"] as? String
    else { return nil }
    self.init(server: server, token: token)
  }
}

enum Drive {
  /** The one drive's name for the system. */
  static let domain = NSFileProviderDomainIdentifier("cloud")
  /** As the Finder calls the place (the app's name; the drive adds none of its own). */
  static let name = "The Office Cloud"

  /** The extension's own folder (in its sandbox), for what it keeps of the server's list. */
  static var folder: URL? {
    guard
      let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        .first
    else { return nil }
    let folder = base.appendingPathComponent("CloudDrive", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }
}
