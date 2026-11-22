import FileProvider
import Foundation
import UniformTypeIdentifiers

/** No server, no session, or it says no: told to the Finder in its own words. */
func asFinderError(_ error: Error) -> Error {
  if let failure = error as? ApiFailure {
    // Asked first: the plan's limit comes as a 403.
    if failure.code == "quota_exceeded" || failure.code == "plan_over_limit" {
      return NSFileProviderError(.insufficientQuota)
    }
    switch failure.status {
    case 401: return NSFileProviderError(.notAuthenticated)
    case 403: return NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)
    case 404: return NSFileProviderError(.noSuchItem)
    // Too large a file (413) is no matter of space, and asking again changes nothing: with
    // `.cannotSynchronize` the system leaves the item be until it is changed on disk.
    default: return NSFileProviderError(.cannotSynchronize)
    }
  }
  if error is URLError { return NSFileProviderError(.serverUnreachable) }
  return error
}

/**
 * The signed-in account's side of the drive: its workspaces (as the server last told, kept so a
 * start begins with them) and what is known of each one's files.
 */
actor Account {
  let config: DriveConfig
  private let file: URL?
  private var listed: [DriveWorkspace]
  private var stores: [String: Store] = [:]

  init(config: DriveConfig) {
    self.config = config
    file = Drive.folder?.appendingPathComponent("workspaces.json")
    listed =
      file.flatMap { try? Data(contentsOf: $0) }.flatMap {
        try? JSONDecoder().decode([DriveWorkspace].self, from: $0)
      } ?? []
  }

  var workspaces: [DriveWorkspace] { listed }
  func workspace(_ id: String) -> DriveWorkspace? { listed.first { $0.id == id } }

  /** The workspaces as the server has them now. */
  @discardableResult
  func refreshWorkspaces() async throws -> [DriveWorkspace] {
    guard let api = Api(config: config, workspace: "") else {
      throw NSFileProviderError(.notAuthenticated)
    }
    listed = try await api.workspaces()
    stores = stores.filter { id, _ in listed.contains { $0.id == id } }
    if let file, let data = try? JSONEncoder().encode(listed) {
      try? data.write(to: file, options: [.atomic])
    }
    return listed
  }

  func store(_ workspace: String) -> Store? {
    guard listed.contains(where: { $0.id == workspace }) else { return nil }
    if let store = stores[workspace] { return store }
    guard let api = Api(config: config, workspace: workspace) else { return nil }
    let store = Store(api: api)
    stores[workspace] = store
    return store
  }

  var all: [Store] { listed.compactMap { store($0.id) } }

  /** The workspace a file or folder of the server's lies in. */
  func store(holding id: String) async -> Store? {
    for store in all where await store.node(id) != nil { return store }
    return nil
  }

  /** The workspace of a Finder folder: a top folder says it, a folder of the server's lies in one. */
  func store(of identifier: NSFileProviderItemIdentifier) async -> Store? {
    if let parts = rootParts(identifier) { return store(parts.workspace) }
    if let workspace = workspaceId(identifier) { return store(workspace) }
    if isFixedPlace(identifier) { return nil }
    return await store(holding: identifier.rawValue)
  }

  /** The server's place for a Finder folder; a workspace's folder is the top of its own area. */
  func place(of identifier: NSFileProviderItemIdentifier) async -> Place? {
    guard let workspace = workspaceId(identifier) else { return CloudDrive.place(of: identifier) }
    guard let home = await store(workspace)?.home else { return nil }
    return Place(areaId: home)
  }

  /** The workspaces' folders at the drive's top. */
  var folders: [Item] {
    get async {
      var items: [Item] = []
      for each in listed {
        items.append(Item(each, canAdd: await store(each.id)?.homeCanEdit ?? false))
      }
      return items
    }
  }

  /** Everything up to date: the workspaces, and each one's files. */
  func refresh() async throws {
    try await refreshWorkspaces()
    for store in all { try await store.refresh() }
  }
}

/**
 * Cloud as a place in the Finder (File Provider, replicated): the system keeps the files on
 * this Mac – placeholders until opened – and asks here for what the server holds and to carry
 * out what is done to them. One drive for the account; at its top a folder per workspace, in
 * each one's own files, the areas (those under an area in its folder) and what lies in the
 * workspace's own area.
 */
final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
  let domain: NSFileProviderDomain
  let account: Account?

  required init(domain: NSFileProviderDomain) {
    self.domain = domain
    account = DriveConfig(domain).map { Account(config: $0) }
    super.init()
  }

  func invalidate() {}

  /** Runs `work` off the caller's queue; the progress it hands back can stop it. */
  private func run(
    _ work: @escaping (Account) async throws -> Void, failed: @escaping (Error) -> Void
  ) -> Progress {
    let progress = Progress(totalUnitCount: 1)
    let task = Task {
      do {
        guard let account else { throw NSFileProviderError(.notAuthenticated) }
        try await work(account)
        progress.completedUnitCount = 1
      } catch {
        failed(asFinderError(error))
      }
    }
    progress.cancellationHandler = { task.cancel() }
    return progress
  }

  private func find(_ identifier: NSFileProviderItemIdentifier, in account: Account) async -> Item? {
    if identifier == .rootContainer { return Item() }
    let raw = identifier.rawValue
    if raw.hasPrefix(workspacePrefix) {
      return await account.folders.first { $0.itemIdentifier == identifier }
    }
    if let parts = rootParts(identifier) {
      guard let store = await account.store(parts.workspace), let root = await store.root(parts.id)
      else { return nil }
      return await store.item(root)
    }
    return await account.store(holding: raw)?.item(raw)
  }

  /** The workspace a file or folder lies in – asked of the server when not known here. */
  private func store(holding id: String, in account: Account) async throws -> Store {
    if let store = await account.store(holding: id) { return store }
    try await account.refresh()
    guard let store = await account.store(holding: id) else {
      throw NSFileProviderError(.noSuchItem)
    }
    return store
  }

  /** Another item of that name (names compare without case) in the folder, as last told. */
  private func twin(
    of id: String, named name: String, in parent: NSFileProviderItemIdentifier, store: Store
  ) async -> Item? {
    await store.items.first {
      $0.itemIdentifier.rawValue != id && $0.parentItemIdentifier == parent
        && $0.filename.compare(name, options: [.caseInsensitive]) == .orderedSame
    }
  }

  /** The item as the server has it now – after something was done to it. */
  private func fresh(_ id: String, in store: Store) async throws -> Item {
    try await store.refresh()
    guard let item = await store.item(id) else { throw NSFileProviderError(.noSuchItem) }
    return item
  }

  func item(
    for identifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest,
    completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void
  ) -> Progress {
    run({ account in
      if let item = await self.find(identifier, in: account) {
        completionHandler(item, nil)
        return
      }
      try await account.refresh()
      guard let item = await self.find(identifier, in: account) else {
        throw NSFileProviderError(.noSuchItem)
      }
      completionHandler(item, nil)
    }) { completionHandler(nil, $0) }
  }

  func fetchContents(
    for itemIdentifier: NSFileProviderItemIdentifier, version requestedVersion: NSFileProviderItemVersion?,
    request: NSFileProviderRequest,
    completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
  ) -> Progress {
    run({ account in
      let id = itemIdentifier.rawValue
      let store = try await self.store(holding: id, in: account)
      let item = try await self.fresh(id, in: store)
      let version = await store.node(id)?.versionId
      let url = try await store.api.download(id, version: version)
      completionHandler(url, item, nil)
    }) { completionHandler(nil, nil, $0) }
  }

  func createItem(
    basedOn itemTemplate: NSFileProviderItem, fields: NSFileProviderItemFields, contents url: URL?,
    options: NSFileProviderCreateItemOptions = [], request: NSFileProviderRequest,
    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
  ) -> Progress {
    run({ account in
      let parent = itemTemplate.parentItemIdentifier
      guard let target = await account.place(of: parent),
        let store = await account.store(of: parent)
      else {
        // Nothing lies beside the workspaces, or in „Geteilt“ itself: they are the server's.
        throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)
      }
      let name = itemTemplate.filename
      let api = store.api
      // A link, or a folder that is one thing to the Finder (a package: `.rtfd`, `.app`): the
      // server has files and folders only. Left out of the drive – it stays on this Mac as it
      // is, and the system does not ask again until it changes (`.excludedFromSync`).
      if let type = itemTemplate.contentType, type != .folder,
        type.conforms(to: .symbolicLink) || type.conforms(to: .directory)
      {
        throw NSFileProviderError(.excludedFromSync)
      }
      if itemTemplate.contentType == .folder {
        var body = target.json
        body["name"] = name
        let data: Data
        do {
          data = try await api.send("POST", "/workspaces/\(api.workspace)/cloud/folders", json: body)
        } catch let failure as ApiFailure where failure.status == 409 {
          // There already: the Finder's folder and the server's are the same one.
          try await store.refresh()
          let twin = await store.items.first {
            $0.parentItemIdentifier == parent && $0.contentType == .folder
              && $0.filename.compare(name, options: [.caseInsensitive]) == .orderedSame
          }
          guard let twin else { throw failure }
          completionHandler(twin, [], false, nil)
          return
        }
        struct Made: Decodable { var id: String }
        let made = try JSONDecoder().decode(Made.self, from: data)
        completionHandler(try await self.fresh(made.id, in: store), [], false, nil)
        return
      }
      guard let url else { throw NSFileProviderError(.cannotSynchronize) }
      let modified = itemTemplate.contentModificationDate ?? nil
      // The server says which file this upload became: that one and no other is the Finder's.
      let made: String
      do {
        made = try await api.upload(
          url, name: name, parent: target, nodeId: nil, ifVersion: "none", modified: modified)
      } catch let failure as ApiFailure where failure.code == "cloud_conflict" {
        // One of that name came there meanwhile: both stay, this one under a free name.
        made = try await api.upload(
          url, name: name, parent: target, nodeId: nil, ifVersion: nil, keepBoth: true,
          modified: modified)
      }
      completionHandler(try await self.fresh(made, in: store), [], false, nil)
    }) { completionHandler(nil, [], false, $0) }
  }

  func modifyItem(
    _ item: NSFileProviderItem, baseVersion version: NSFileProviderItemVersion,
    changedFields: NSFileProviderItemFields, contents newContents: URL?,
    options: NSFileProviderModifyItemOptions = [], request: NSFileProviderRequest,
    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
  ) -> Progress {
    run({ account in
      let id = item.itemIdentifier.rawValue
      guard !isFixedPlace(item.itemIdentifier) else {
        // A fixed place (a workspace, „Meine Dateien“, a team's): the Finder notes things on it
        // by itself (last opened, its view's attributes). Refusing leaves the place marked as
        // failed – a cloud with „!“ – and the system asking again; the place as it is says the
        // same without the mark, and puts a name or a move back.
        guard let place = await self.find(item.itemIdentifier, in: account) else {
          throw NSFileProviderError(.noSuchItem)
        }
        completionHandler(place, [], false, nil)
        return
      }
      let store = try await self.store(holding: id, in: account)
      let api = store.api
      // A name taken where the item is to lie: the system gives one of the two another name and
      // asks again (`.filenameCollision`, which needs the item in the way).
      func rename() async throws {
        do {
          _ = try await api.send("PATCH", "/cloud/nodes/\(id)", json: ["name": item.filename])
        } catch let failure as ApiFailure where failure.status == 409 {
          try await store.refresh()
          let here = await store.item(id)?.parentItemIdentifier ?? item.parentItemIdentifier
          guard let twin = await self.twin(of: id, named: item.filename, in: here, store: store)
          else { throw failure }
          throw NSError.fileProviderErrorForCollision(with: twin)
        }
      }
      var renamed = false
      if changedFields.contains(.parentItemIdentifier) {
        // Into another workspace is no move: a file belongs to the one it lies in.
        guard let target = await account.place(of: item.parentItemIdentifier),
          await account.store(of: item.parentItemIdentifier) === store
        else {
          throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)
        }
        var body = target.json
        body["ids"] = [id]
        // The server answers 200 also when it refused, and names the item among `skipped`.
        func move() async throws -> Bool {
          !Api.skipped(id, in: try await api.send("POST", "/cloud/nodes/move", json: body))
        }
        var moved = try await move()
        if !moved, changedFields.contains(.filename) {
          // Moved and renamed in one: the name it had may be the one taken there.
          try await rename()
          renamed = true
          moved = try await move()
        }
        if !moved {
          try await store.refresh()
          let name = await store.item(id)?.filename ?? item.filename
          if let twin = await self.twin(
            of: id, named: name, in: item.parentItemIdentifier, store: store)
          {
            throw NSError.fileProviderErrorForCollision(with: twin)
          }
          // Refused for another reason (shared and staying where it lies, too deep): the item
          // as the server has it is the answer below, and the Finder puts it back there.
        }
      }
      if changedFields.contains(.filename), !renamed { try await rename() }
      var theirs = false
      if changedFields.contains(.contents), let newContents {
        let base = String(data: version.contentVersion, encoding: .utf8)
        do {
          try await api.upload(newContents, name: item.filename, parent: nil, nodeId: id, ifVersion: base)
        } catch let failure as ApiFailure where failure.code == "cloud_conflict" {
          // Changed there too: the server's stays the file, this Mac's goes up beside it.
          var beside: Place?
          if let here = await store.item(id)?.parentItemIdentifier {
            beside = await account.place(of: here)
          }
          let ext = (item.filename as NSString).pathExtension
          let stem = (item.filename as NSString).deletingPathExtension
          let name = "\(stem) (Konflikt)" + (ext.isEmpty ? "" : ".\(ext)")
          try await api.upload(newContents, name: name, parent: beside, nodeId: nil, ifVersion: nil, keepBoth: true)
          // What lies here under the file's name is no longer the file: fetched anew.
          theirs = true
        }
      }
      completionHandler(try await self.fresh(id, in: store), [], theirs, nil)
    }) { completionHandler(nil, [], false, $0) }
  }

  func deleteItem(
    identifier: NSFileProviderItemIdentifier, baseVersion version: NSFileProviderItemVersion,
    options: NSFileProviderDeleteItemOptions = [], request: NSFileProviderRequest,
    completionHandler: @escaping (Error?) -> Void
  ) -> Progress {
    run({ account in
      let id = identifier.rawValue
      guard !isFixedPlace(identifier) else {
        throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)
      }
      // Not in the list kept here (it may be half told, or old): the server is asked before
      // the Finder hears „gone“. Unknown there too means gone there.
      var known = await account.store(holding: id)
      if known == nil {
        try await account.refresh()
        known = await account.store(holding: id)
      }
      guard let store = known else {
        completionHandler(nil)
        return
      }
      // Into Cloud's „Gelöscht“, where it stays 30 days.
      var refused = false
      do {
        let answer = try await store.api.send("POST", "/cloud/nodes/trash", json: ["ids": [id]])
        // The server answers 200 also when it refused, and names the item among `skipped`.
        refused = Api.skipped(id, in: answer)
      } catch let failure as ApiFailure where failure.status == 404 {
        // Gone there already.
      }
      if refused {
        // Still there after asking anew: it may not be deleted (no right to, most likely). The
        // Finder puts it back as the server has it. Gone meanwhile: nothing was refused.
        try await store.refresh()
        if let still = await store.item(id) {
          throw NSError.fileProviderErrorForRejectedDeletion(of: still)
        }
      } else {
        try? await store.refresh()
      }
      completionHandler(nil)
    }) { completionHandler($0) }
  }

  func enumerator(
    for containerItemIdentifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest
  ) throws -> NSFileProviderEnumerator {
    guard let account else { throw NSFileProviderError(.notAuthenticated) }
    // No trash of its own: deleting goes to Cloud's „Gelöscht“ right away.
    if containerItemIdentifier == .trashContainer {
      throw NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError)
    }
    return Enumerator(container: containerItemIdentifier, account: account)
  }
}

/**
 * Where the Finder stands with the drive: which workspaces it knew, and for each the server's
 * cursor.
 */
struct Anchor: Codable {
  /** How the folders lie in one another: a Finder that knew another way begins anew. */
  static let layout = 2
  var workspaces: [DriveWorkspace] = []
  var cursors: [String: String] = [:]
  var layout: Int?

  init(workspaces: [DriveWorkspace] = [], cursors: [String: String] = [:]) {
    self.workspaces = workspaces
    self.cursors = cursors
    layout = Anchor.layout
  }

  init?(_ anchor: NSFileProviderSyncAnchor) {
    guard let value = try? JSONDecoder().decode(Anchor.self, from: anchor.rawValue) else {
      return nil
    }
    self = value
  }

  var anchor: NSFileProviderSyncAnchor {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return NSFileProviderSyncAnchor((try? encoder.encode(self)) ?? Data())
  }
}

final class Enumerator: NSObject, NSFileProviderEnumerator {
  let container: NSFileProviderItemIdentifier
  let account: Account

  init(container: NSFileProviderItemIdentifier, account: Account) {
    self.container = container
    self.account = account
  }

  func invalidate() {}

  private func inHere(_ item: Item) -> Bool {
    container == .workingSet || item.parentItemIdentifier == container
  }

  func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
    Task {
      do {
        try await account.refresh()
        var items = await account.folders
        for store in await account.all { items += await store.items }
        observer.didEnumerate(items.filter(inHere))
        observer.finishEnumerating(upTo: nil)
      } catch {
        observer.finishEnumeratingWithError(asFinderError(error))
      }
    }
  }

  func enumerateChanges(for observer: NSFileProviderChangeObserver, from anchor: NSFileProviderSyncAnchor) {
    Task {
      do {
        let workspaces = try await account.refreshWorkspaces()
        // Another set of workspaces (joined, left, renamed), the folders lying another way, or
        // the Finder knows nothing yet: it begins anew.
        guard let since = Anchor(anchor), since.workspaces == workspaces,
          since.layout == Anchor.layout
        else {
          observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired))
          return
        }
        var next = Anchor(workspaces: workspaces)
        var changed: [Item] = []
        var gone: [NSFileProviderItemIdentifier] = []
        var more = false
        for store in await account.all {
          let workspace = store.api.workspace
          guard let cursor = since.cursors[workspace] else {
            observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired))
            return
          }
          let page = try await store.changes(since: cursor)
          // The server begins anew (who sees what changed, or away too long): so does the Finder.
          if page.reset {
            observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired))
            return
          }
          for node in page.nodes { changed.append(await store.item(node)) }
          // The top folders every time, and those that went: they carry no cursor, and the
          // list here may have heard of an area renamed or deleted before the Finder asked (any
          // other call brings it) – compared with that list, nothing would have changed. Told
          // again, an unchanged one changes nothing.
          changed += await store.items.filter { isFixedPlace($0.itemIdentifier) }
          gone += page.removed.map { NSFileProviderItemIdentifier($0) }
          gone += await store.left.map { rootIdentifier(workspace, $0) }
          next.cursors[workspace] = page.cursor
          more = more || page.more
        }
        // Moved out of this folder counts as changed for the whole drive only.
        observer.didUpdate(changed.filter(inHere))
        if !gone.isEmpty { observer.didDeleteItems(withIdentifiers: gone) }
        observer.finishEnumeratingChanges(upTo: next.anchor, moreComing: more)
      } catch {
        observer.finishEnumeratingWithError(asFinderError(error))
      }
    }
  }

  func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
    Task {
      try? await account.refresh()
      var now = Anchor(workspaces: await account.workspaces)
      for store in await account.all {
        if let cursor = await store.cursor { now.cursors[store.api.workspace] = cursor }
      }
      completionHandler(now.anchor)
    }
  }
}
