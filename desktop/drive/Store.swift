import Foundation

/**
 * What the extension knows of a workspace's files: the server's list as last told, kept in the
 * extension's own folder so a start of the extension begins where the last one stopped.
 */
actor Store {
  struct Kept: Codable {
    var cursor: String?
    var roots: [DriveRoot] = []
    var nodes: [String: DriveNode] = [:]
    /** Top folders that were there once and are not now (optional: lists kept before it). */
    var left: [String]?
  }

  let api: Api
  private let file: URL?
  private var kept: Kept
  /** The refresh under way. */
  private var refreshing: Task<Void, Error>?

  init(api: Api) {
    self.api = api
    file = Drive.folder?.appendingPathComponent("files-\(api.workspace).json")
    kept =
      file.flatMap { try? Data(contentsOf: $0) }.flatMap {
        try? JSONDecoder().decode(Kept.self, from: $0)
      } ?? Kept()
  }

  var cursor: String? { kept.cursor }
  /** The workspace's own area: no folder, what lies in it lies in the workspace's folder. */
  private var homeRoot: DriveRoot? { kept.roots.first { $0.kind == "workspace" } }
  var home: String? { homeRoot?.id }
  /** Whether something may be put into the workspace's folder – into its own area, that is. */
  var homeCanEdit: Bool { homeRoot?.canEdit ?? false }
  /** The top folders: one's own files, the areas, „Geteilt“. */
  var roots: [DriveRoot] { kept.roots.filter { $0.kind != "workspace" } }
  /**
   * The ids of top folders that are gone – an area deleted, or one the account left. The
   * workspace's own area among them: it was a folder once, and a Mac that knew it lets it go.
   */
  var left: [String] { (kept.left ?? []) + (home.map { [$0] } ?? []) }
  var nodes: [DriveNode] { Array(kept.nodes.values) }
  /** Everything in the workspace as the Finder's items: its files and folders, and its top folders. */
  var items: [Item] { kept.nodes.values.map(item) + roots.map(item) }
  func item(_ node: DriveNode) -> Item { Item(node, in: api.workspace, home: home) }
  func item(_ root: DriveRoot) -> Item { Item(root, in: api.workspace, home: home) }
  func item(_ id: String) -> Item? { kept.nodes[id].map(item) }
  func node(_ id: String) -> DriveNode? { kept.nodes[id] }
  func root(_ id: String) -> DriveRoot? { roots.first { $0.id == id } }

  private func save() {
    guard let file, let data = try? JSONEncoder().encode(kept) else { return }
    try? data.write(to: file, options: [.atomic])
  }

  /** One answer of the server taken in; twice changes nothing. */
  private func take(_ page: DriveChanges) {
    if page.reset { kept.nodes = [:] }
    for node in page.nodes { kept.nodes[node.id] = node }
    for id in page.removed { kept.nodes[id] = nil }
    // Remembered, not told once: any caller's answer comes through here, also one the Finder
    // did not ask for – the next time it asks, this list no longer shows what went.
    let now = Set(page.roots.map(\.id))
    kept.left = Set(kept.left ?? []).union(kept.roots.map(\.id)).subtracting(now).sorted()
    kept.roots = page.roots
  }

  /**
   * Up to date with the server: everything it tells from where the list stands. One at a time
   * (the actor lets a second caller in at every wait, and two walking the pages at once – one of
   * them starting over – would keep half a list). Who comes meanwhile waits and then asks
   * itself: what it is after may have happened after the one under way began.
   */
  func refresh() async throws {
    while let running = refreshing { _ = try? await running.value }
    let task = Task { try await self.pull() }
    refreshing = task
    defer { refreshing = nil }
    try await task.value
  }

  private func pull() async throws {
    var more = true
    while more {
      let page = try await api.changes(cursor: kept.cursor)
      take(page)
      kept.cursor = page.cursor
      more = page.more
    }
    save()
  }

  /** What changed since `cursor` (the system's own bookmark, which may lag behind the list's). */
  func changes(since cursor: String?) async throws -> DriveChanges {
    let page = try await api.changes(cursor: cursor)
    if !page.reset {
      take(page)
      save()
    }
    return page
  }
}
