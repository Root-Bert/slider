import FileProvider
import Foundation

/** A file or folder as `GET …/cloud/changes` tells it (`cloudDriveNodeSchema`). */
struct DriveNode: Codable {
  var id: String
  var rootId: String
  var parentId: String?
  var kind: String
  var name: String
  var sizeBytes: Int64
  var versionId: String?
  var sha256: String?
  var createdAt: String
  var modifiedAt: String
  var canEdit: Bool
}

/**
 * Where files lie at the top: one's own files, or an area. The workspace's own area (`workspace`)
 * is no folder – what lies in it lies in the workspace's; an area under another (`parentId`) is
 * a folder in that one's.
 */
struct DriveRoot: Codable, Equatable {
  var id: String
  var kind: String
  var parentId: String?
  var name: String
  var canEdit: Bool
}

struct DriveChanges: Codable {
  var cursor: String
  var reset: Bool
  var more: Bool
  var roots: [DriveRoot]
  var nodes: [DriveNode]
  var removed: [String]
}

/** A workspace of the account, as its folder at the drive's top is called. */
struct DriveWorkspace: Codable, Equatable {
  var id: String
  var name: String
}

struct ApiFailure: Error {
  var status: Int
  var code: String
}

/** The server's API for one workspace (none: the account's own calls), as the signed-in account. */
struct Api {
  let server: URL
  let token: String
  let workspace: String

  init?(config: DriveConfig, workspace: String) {
    guard let server = URL(string: config.server) else { return nil }
    self.server = server
    self.token = config.token
    self.workspace = workspace
  }

  func request(_ method: String, _ path: String, query: [String: String?] = [:]) -> URLRequest {
    var parts = URLComponents(
      url: server.appendingPathComponent("api" + path), resolvingAgainstBaseURL: false)!
    let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
    if !items.isEmpty {
      parts.queryItems = items
      // A `+` in a name must not arrive as a space.
      parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(
        of: "+", with: "%2B")
    }
    var request = URLRequest(url: parts.url!)
    request.httpMethod = method
    // As the server names its cookie (auth/cookies.ts): `__Host-` on https.
    let name = server.scheme == "https" ? "__Host-slider_session" : "slider_session"
    request.setValue("\(name)=\(token)", forHTTPHeaderField: "Cookie")
    request.httpShouldHandleCookies = false
    return request
  }

  static func check(_ data: Data?, _ response: URLResponse) throws {
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    if (200..<300).contains(http.statusCode) { return }
    struct Body: Decodable {
      struct Failure: Decodable { var code: String }
      var error: Failure
    }
    let code = data.flatMap { try? JSONDecoder().decode(Body.self, from: $0) }?.error.code
    throw ApiFailure(status: http.statusCode, code: code ?? "")
  }

  func send(_ method: String, _ path: String, query: [String: String?] = [:], json: Any? = nil)
    async throws -> Data
  {
    var request = request(method, path, query: query)
    if let json {
      request.httpBody = try JSONSerialization.data(withJSONObject: json)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await URLSession.shared.data(for: request)
    try Api.check(data, response)
    return data
  }

  /**
   * The account's workspaces, each under a name a folder can carry – and no two the same: the
   * later one (by id, so it stays the same one) says which it is.
   */
  func workspaces() async throws -> [DriveWorkspace] {
    struct Listed: Decodable {
      var id: String
      var name: String
    }
    let listed = try JSONDecoder().decode([Listed].self, from: try await send("GET", "/workspaces"))
    var names = FolderNames(fallback: "Workspace")
    return listed.sorted { $0.id < $1.id }.map { each in
      DriveWorkspace(id: each.id, name: names.free(each.name))
    }
  }

  /**
   * What changed since `cursor`. The top folders come under names a folder can carry, as the
   * workspaces do: the fixed ones („Meine Dateien“, „Geteilt“) keep theirs, an area called the
   * same or like another one in the same folder says which it is (by id, so it stays the same
   * one).
   */
  func changes(cursor: String?) async throws -> DriveChanges {
    let data = try await send(
      "GET", "/workspaces/\(workspace)/cloud/changes", query: ["cursor": cursor, "limit": "2000"])
    var page = try JSONDecoder().decode(DriveChanges.self, from: data)
    let home = page.roots.first { $0.kind == "workspace" }?.id
    // One list of names per folder: the workspace's (""), or an area's for those under it.
    var names: [String: FolderNames] = [:]
    var named: [String: String] = [:]
    func name(_ root: DriveRoot) {
      let folder = root.parentId == home ? "" : root.parentId ?? ""
      named[root.id] = names[folder, default: FolderNames(fallback: "Bereich")].free(root.name)
    }
    for root in page.roots where root.kind != "area" && root.kind != "workspace" { name(root) }
    for root in page.roots.sorted(by: { $0.id < $1.id }) where root.kind == "area" { name(root) }
    page.roots = page.roots.map { root in
      var root = root
      root.name = named[root.id] ?? root.name
      return root
    }
    return page
  }

  /** The file's bytes, into a file of the system's choosing. */
  func download(_ id: String, version: String?) async throws -> URL {
    let request = request("GET", "/cloud/nodes/\(id)/content", query: ["download": "1", "v": version])
    let (url, response) = try await URLSession.shared.download(for: request)
    try Api.check(nil, response)
    return url
  }

  /**
   * From this size on a file goes up in parts, each this large (`CLOUD_UPLOAD_IN_PARTS_FROM`,
   * `CLOUD_UPLOAD_PART_BYTES`: the same number).
   */
  static let partBytes = 32 * 1024 * 1024
  /** Waits before a part is tried again, as the browser's (`RETRY_DELAYS_MS`). */
  static let partRetries: [UInt64] = [0, 1, 3, 5, 10]

  /**
   * A file's bytes up: a new file in `parent`, or (`nodeId`) the next version of one. `ifVersion`
   * is the version the change was made on (`none`: there must be no such file) – refused with
   * `cloud_conflict` when the server holds another by now. Answers the file's id there. A large
   * file goes in parts (`uploadInParts`): what stands before the server takes less per request.
   */
  @discardableResult
  func upload(
    _ file: URL, name: String, parent: Place?, nodeId: String?, ifVersion: String?,
    keepBoth: Bool = false, modified: Date? = nil
  ) async throws -> String {
    // The file's own time, in ms (`cloudUploadQuerySchema.modifiedAt`: a positive whole number).
    let stamp = modified.map { Int64(($0.timeIntervalSince1970 * 1000).rounded()) }
    let query: [String: String?] = [
      "name": name, "parentId": parent?.parentId, "areaId": parent?.areaId, "nodeId": nodeId,
      "ifVersion": ifVersion, "keepBoth": keepBoth ? "1" : nil,
      "modifiedAt": stamp.flatMap { $0 > 0 ? String($0) : nil },
    ]
    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
    if size >= Api.partBytes { return try await uploadInParts(file, query: query) }
    var request = request("POST", "/workspaces/\(workspace)/cloud/files", query: query)
    request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    let (data, response) = try await URLSession.shared.upload(for: request, fromFile: file)
    try Api.check(data, response)
    return try Api.stored(data)
  }

  /** `CloudUploadResult`: the file as it lies there now – its id says which upload this is. */
  private static func stored(_ data: Data) throws -> String {
    struct Stored: Decodable {
      struct Node: Decodable { var id: String }
      var node: Node
    }
    return try JSONDecoder().decode(Stored.self, from: data).node.id
  }

  /** A request of the upload in parts (`cloud-tus.ts`): none goes without the tus version. */
  private func tus(_ method: String, _ path: String = "") -> URLRequest {
    var request = request(method, "/cloud/tus" + path)
    request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
    return request
  }

  /**
   * Whether asking again can help: the server not reached or failing, or the upload taken by a
   * request before this one (409, 423). Any other refusal stands, and so does being stopped.
   */
  private static func again(_ error: Error) -> Bool {
    if let failure = error as? ApiFailure {
      return failure.status >= 500 || failure.status == 423
        || (failure.status == 409 && failure.code != "cloud_conflict")
    }
    if let error = error as? URLError { return error.code != .cancelled }
    return false
  }

  /**
   * A large file up in parts, as the browser sends it: the upload is begun with everything
   * `upload` puts in its address, the bytes follow part by part, and finishing stores the file
   * and answers as the whole upload does – with the same refusals. A part that failed is sent
   * again from where the server says it stands; given up, what the server has of it goes too.
   */
  private func uploadInParts(_ file: URL, query: [String: String?]) async throws -> String {
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    let size = try handle.seekToEnd()
    // `filetype` as the whole upload's Content-Type: the server makes the same of both.
    var metadata = query.compactMapValues { $0 }
    metadata["workspaceId"] = workspace
    metadata["filetype"] = "application/octet-stream"
    var create = tus("POST")
    create.setValue(String(size), forHTTPHeaderField: "Upload-Length")
    create.setValue(
      metadata.map { "\($0) \(Data($1.utf8).base64EncodedString())" }.joined(separator: ","),
      forHTTPHeaderField: "Upload-Metadata")
    // Not asked twice: an answer lost on the way would leave a second upload holding room.
    let (refusal, created) = try await URLSession.shared.data(for: create)
    try Api.check(refusal, created)
    // `Location: /api/cloud/tus/<id>`.
    guard
      let id = (created as? HTTPURLResponse)?.value(forHTTPHeaderField: "Location")?
        .split(separator: "/").last.map(String.init), !id.isEmpty
    else { throw URLError(.badServerResponse) }
    do {
      var offset: UInt64 = 0
      var failures = 0
      // After a failure: where the server stands is asked, not assumed.
      var asked = true
      while offset < size {
        do {
          if !asked {
            let (data, response) = try await URLSession.shared.data(for: tus("GET", "/\(id)"))
            try Api.check(data, response)
            guard
              let stands = (response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "Upload-Offset").flatMap(UInt64.init), stands <= size
            else { throw URLError(.badServerResponse) }
            // Bytes arrived since the last failure: the line holds, the count starts anew.
            if stands > offset { failures = 0 }
            offset = stands
            asked = true
            continue
          }
          try handle.seek(toOffset: offset)
          let want = Int(min(UInt64(Api.partBytes), size - offset))
          // Shorter than when it was measured: not the file that was to go up.
          guard let bytes = try handle.read(upToCount: want), !bytes.isEmpty else {
            throw CocoaError(.fileReadUnknown)
          }
          var part = tus("PATCH", "/\(id)")
          part.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
          part.setValue(String(offset), forHTTPHeaderField: "Upload-Offset")
          let (data, response) = try await URLSession.shared.upload(for: part, from: bytes)
          try Api.check(data, response)
          offset =
            (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Upload-Offset")
            .flatMap(UInt64.init) ?? offset + UInt64(bytes.count)
          failures = 0
        } catch {
          guard Api.again(error), failures < Api.partRetries.count else { throw error }
          try await Task.sleep(nanoseconds: Api.partRetries[failures] * 1_000_000_000)
          failures += 1
          asked = false
        }
      }
      // Storing a large file takes its time; the answer lost on the way, the server keeps it
      // and gives it again.
      var finish = tus("POST", "/\(id)/finish")
      finish.timeoutInterval = 300
      var refused: ApiFailure?
      for attempt in 1... {
        do {
          let (data, response) = try await URLSession.shared.data(for: finish)
          try Api.check(data, response)
          return try Api.stored(data)
        } catch {
          // Refused the time before and gone by now: the refusal is the answer, not the 404.
          if let refused, (error as? ApiFailure)?.status == 404 { throw refused }
          guard Api.again(error), attempt < 5 else { throw error }
          refused = error as? ApiFailure ?? refused
          try await Task.sleep(nanoseconds: 2_000_000_000)
        }
      }
      throw URLError(.badServerResponse)
    } catch {
      // Given up or stopped: the server need not keep the parts. Asked apart from this task,
      // which may be the one that was stopped.
      var abort = tus("DELETE", "/\(id)")
      abort.timeoutInterval = 10
      _ = await Task.detached { [abort] in try? await URLSession.shared.data(for: abort) }.value
      throw error
    }
  }

  /**
   * Whether the server left `id` out of something done to several at once (move, trash): those
   * answer 200 and name what they refused in `skipped` (`CloudBatchResult`).
   */
  static func skipped(_ id: String, in answer: Data) -> Bool {
    struct Batch: Decodable {
      struct Skipped: Decodable { var id: String }
      var skipped: [Skipped]
    }
    guard let batch = try? JSONDecoder().decode(Batch.self, from: answer) else { return false }
    return batch.skipped.contains { $0.id == id }
  }
}

/**
 * Names folders can carry at the drive's top, no two the same (the Finder compares without
 * case): a later one of the same name says which it is.
 */
struct FolderNames {
  let fallback: String
  private var taken = Set<String>()

  init(fallback: String) { self.fallback = fallback }

  mutating func free(_ raw: String) -> String {
    var name = raw.replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty || name.hasPrefix(".") { name = fallback }
    var free = name
    var count = 2
    while taken.contains(free.lowercased()) {
      free = "\(name) \(count)"
      count += 1
    }
    taken.insert(free.lowercased())
    return free
  }
}

/** A folder, or the top of an area or of one's own files (neither set). */
struct Place {
  var parentId: String?
  var areaId: String?

  var json: [String: Any] {
    var value: [String: Any] = [:]
    if let parentId { value["parentId"] = parentId }
    if let areaId { value["areaId"] = areaId }
    return value
  }
}
