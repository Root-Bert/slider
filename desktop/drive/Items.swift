import FileProvider
import Foundation
import UniformTypeIdentifiers

/**
 * Folders the server has no file for: at the drive's top one per workspace (`ws:<workspace>`),
 * in each one's own files, the areas and „Geteilt“ (`root:<workspace>:<id>`) – an area under
 * another in that one's folder. The workspace's own area has none: what lies in it lies in the
 * workspace's folder, beside those.
 */
let rootPrefix = "root:"
let workspacePrefix = "ws:"

func rootIdentifier(_ workspace: String, _ id: String) -> NSFileProviderItemIdentifier {
  NSFileProviderItemIdentifier("\(rootPrefix)\(workspace):\(id)")
}

func workspaceIdentifier(_ workspace: String) -> NSFileProviderItemIdentifier {
  NSFileProviderItemIdentifier(workspacePrefix + workspace)
}

/** A top folder's workspace and its id there (`mine`, `shared`, an area's). */
func rootParts(_ identifier: NSFileProviderItemIdentifier) -> (workspace: String, id: String)? {
  let raw = identifier.rawValue
  guard raw.hasPrefix(rootPrefix) else { return nil }
  let parts = raw.dropFirst(rootPrefix.count).split(separator: ":", maxSplits: 1)
  guard parts.count == 2 else { return nil }
  return (String(parts[0]), String(parts[1]))
}

/** Not a file or folder of the server's: the drive, a workspace's folder, a top folder. */
func isFixedPlace(_ identifier: NSFileProviderItemIdentifier) -> Bool {
  identifier == .rootContainer || identifier.rawValue.hasPrefix(rootPrefix)
    || identifier.rawValue.hasPrefix(workspacePrefix)
}

/** The workspace a workspace's folder stands for. */
func workspaceId(_ identifier: NSFileProviderItemIdentifier) -> String? {
  let raw = identifier.rawValue
  return raw.hasPrefix(workspacePrefix) ? String(raw.dropFirst(workspacePrefix.count)) : nil
}

/** Where a top folder or something at an area's top lies: the area above, or the workspace's. */
private func folderOf(_ workspace: String, above: String?, home: String?)
  -> NSFileProviderItemIdentifier
{
  guard let above, above != home else { return workspaceIdentifier(workspace) }
  return rootIdentifier(workspace, above)
}

/**
 * The server's place for a Finder folder: a folder, an area's top, or the top of one's own. A
 * workspace's folder is the top of its own area (`Account.place` – asked of the workspace).
 */
func place(of identifier: NSFileProviderItemIdentifier) -> Place? {
  let raw = identifier.rawValue
  if identifier == .rootContainer || identifier == .trashContainer || identifier == .workingSet {
    return nil
  }
  if raw.hasPrefix(workspacePrefix) { return nil }
  guard raw.hasPrefix(rootPrefix) else { return Place(parentId: raw) }
  guard let root = rootParts(identifier)?.id else { return nil }
  // „Geteilt“ is no place of the server's: what lies at its top lies in someone's own files.
  if root == "shared" { return nil }
  return root == "mine" ? Place() : Place(areaId: root)
}

private let stamps: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter
}()

final class Item: NSObject, NSFileProviderItem {
  let itemIdentifier: NSFileProviderItemIdentifier
  let parentItemIdentifier: NSFileProviderItemIdentifier
  let filename: String
  let contentType: UTType
  let capabilities: NSFileProviderItemCapabilities
  let documentSize: NSNumber?
  let creationDate: Date?
  let contentModificationDate: Date?
  let itemVersion: NSFileProviderItemVersion

  init(_ node: DriveNode, in workspace: String, home: String?) {
    itemIdentifier = NSFileProviderItemIdentifier(node.id)
    parentItemIdentifier =
      node.parentId.map { NSFileProviderItemIdentifier($0) }
      ?? folderOf(workspace, above: node.rootId, home: home)
    filename = node.name
    let folder = node.kind == "folder"
    contentType =
      folder
      ? .folder
      : UTType(filenameExtension: (node.name as NSString).pathExtension) ?? .data
    var can: NSFileProviderItemCapabilities = [.allowsReading]
    if folder { can.insert(.allowsContentEnumerating) }
    if node.canEdit {
      can.formUnion([.allowsRenaming, .allowsReparenting, .allowsDeleting])
      can.insert(folder ? .allowsAddingSubItems : .allowsWriting)
    }
    capabilities = can
    documentSize = folder ? nil : NSNumber(value: node.sizeBytes)
    creationDate = stamps.date(from: node.createdAt)
    contentModificationDate = stamps.date(from: node.modifiedAt)
    itemVersion = NSFileProviderItemVersion(
      contentVersion: Data((node.versionId ?? "folder").utf8),
      metadataVersion: Data("\(node.name)|\(node.parentId ?? node.rootId)|\(node.canEdit)".utf8))
  }

  init(_ root: DriveRoot, in workspace: String, home: String?) {
    itemIdentifier = rootIdentifier(workspace, root.id)
    parentItemIdentifier = folderOf(workspace, above: root.parentId, home: home)
    filename = root.name
    contentType = .folder
    capabilities =
      root.canEdit
      ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems]
      : [.allowsReading, .allowsContentEnumerating]
    documentSize = nil
    creationDate = nil
    contentModificationDate = nil
    itemVersion = NSFileProviderItemVersion(
      contentVersion: Data("folder".utf8), metadataVersion: Data("\(root.name)|\(root.parentId ?? "")|\(root.canEdit)".utf8))
  }

  /** A workspace's folder at the drive's top; `canAdd`: its own area takes what is put there. */
  init(_ workspace: DriveWorkspace, canAdd: Bool) {
    itemIdentifier = workspaceIdentifier(workspace.id)
    parentItemIdentifier = .rootContainer
    filename = workspace.name
    contentType = .folder
    capabilities =
      canAdd
      ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems]
      : [.allowsReading, .allowsContentEnumerating]
    documentSize = nil
    creationDate = nil
    contentModificationDate = nil
    itemVersion = NSFileProviderItemVersion(
      contentVersion: Data("folder".utf8), metadataVersion: Data("\(workspace.name)|\(canAdd)".utf8))
  }

  /** The drive itself. */
  override init() {
    itemIdentifier = .rootContainer
    parentItemIdentifier = .rootContainer
    filename = Drive.name
    contentType = .folder
    capabilities = [.allowsReading, .allowsContentEnumerating]
    documentSize = nil
    creationDate = nil
    contentModificationDate = nil
    itemVersion = NSFileProviderItemVersion(
      contentVersion: Data("folder".utf8), metadataVersion: Data("top".utf8))
  }
}
