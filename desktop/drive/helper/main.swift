import FileProvider
import Foundation
import UniformTypeIdentifiers

// The app's hand for the drive (Electron cannot call the File Provider itself):
//   cloud-drive set <server>         the account's drive – one place in the Finder, a folder per
//                                    workspace in it; the session token comes on stdin. Again
//                                    for the drive there: its new token
//   cloud-drive signout              the drive goes, and the session with it
//   cloud-drive list
//   cloud-drive signal               the server has news: the Finder asks again
//   cloud-drive path <node id>       where that file lies on this computer – opened there, the
//                                    system fetches it first
//   cloud-drive local                the ids of the files whose bytes are on this computer
//   cloud-drive evict <node id>      its bytes leave this computer; the file stays in the Finder
//                                    and is fetched again when opened

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func domains() async throws -> [NSFileProviderDomain] {
  try await NSFileProviderManager.domains()
}

func manager() async throws -> NSFileProviderManager {
  guard let domain = try await domains().first(where: { $0.identifier == Drive.domain }),
    let manager = NSFileProviderManager(for: domain)
  else { fail("No drive") }
  return manager
}

/** Takes what the system has on this computer, page by page. */
final class Materialized: NSObject, NSFileProviderEnumerationObserver {
  let enumerator: NSFileProviderEnumerator
  let finished: (Error?) -> Void
  var files: [String] = []

  init(_ enumerator: NSFileProviderEnumerator, finished: @escaping (Error?) -> Void) {
    self.enumerator = enumerator
    self.finished = finished
  }

  func start() {
    enumerator.enumerateItems(
      for: self, startingAt: NSFileProviderPage(NSFileProviderPage.initialPageSortedByName as Data))
  }

  func didEnumerate(_ updatedItems: [NSFileProviderItemProtocol]) {
    for item in updatedItems where item.contentType?.conforms(to: .folder) != true {
      files.append(item.itemIdentifier.rawValue)
    }
  }

  func finishEnumerating(upTo nextPage: NSFileProviderPage?) {
    if let nextPage { enumerator.enumerateItems(for: self, startingAt: nextPage) } else {
      finished(nil)
    }
  }

  func finishEnumeratingWithError(_ error: Error) { finished(error) }
}

let args = Array(CommandLine.arguments.dropFirst())
let done = DispatchSemaphore(value: 0)
Task {
  do {
    switch args.first {
    case "signout":
      // What was changed here and not yet sent stays on this computer.
      for domain in try await domains() {
        _ = try await NSFileProviderManager.remove(domain, mode: .preserveDirtyUserData)
      }
    case "set":
      guard args.count == 2, let token = readLine(strippingNewline: true), !token.isEmpty else {
        fail("set <server>, the token on stdin")
      }
      // Drives from before (one per workspace) go; what was changed in them and not yet sent
      // stays on this computer.
      for domain in try await domains() where domain.identifier != Drive.domain {
        _ = try await NSFileProviderManager.remove(domain, mode: .preserveDirtyUserData)
      }
      // No name of its own: the Finder calls the place as the app is called.
      let domain = NSFileProviderDomain(identifier: Drive.domain, displayName: "")
      domain.userInfo = DriveConfig(server: args[1], token: token).userInfo
      try await NSFileProviderManager.add(domain)
      // Off in the System Settings – as macOS leaves every new drive until the user switches it
      // on there, and no call does that for them: the place is there and shows nothing. Said
      // with an exit code of its own (2), so the app can lead there.
      if let now = try await domains().first(where: { $0.identifier == Drive.domain }),
        !now.userEnabled
      {
        FileHandle.standardError.write(Data("The drive is switched off in System Settings\n".utf8))
        exit(2)
      }
    case "list":
      for domain in try await domains() {
        print("\(domain.identifier.rawValue)\t\(domain.displayName)")
      }
    case "signal":
      for domain in try await domains() {
        try await NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet)
      }
    case "path":
      guard args.count == 2 else { fail("path <node id>") }
      let url = try await manager().getUserVisibleURL(for: NSFileProviderItemIdentifier(args[1]))
      print(url.path)
    case "evict":
      guard args.count == 2 else { fail("evict <node id>") }
      // The system refuses what is changed here and not yet sent: nothing is lost.
      try await manager().evictItem(identifier: NSFileProviderItemIdentifier(args[1]))
    case "local":
      let enumerator = try await manager().enumeratorForMaterializedItems()
      let files: [String] = try await withCheckedThrowingContinuation { continuation in
        var walk: Materialized?
        walk = Materialized(enumerator) { error in
          if let error { continuation.resume(throwing: error) } else {
            continuation.resume(returning: walk?.files ?? [])
          }
          walk = nil
        }
        walk?.start()
      }
      print(files.joined(separator: "\n"))
    default:
      fail("set | signout | list | signal | path | local | evict")
    }
  } catch {
    fail("\(error)")
  }
  done.signal()
}
done.wait()
