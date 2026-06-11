/// Data models for file tree and file state representation.
library;

class FileInfo {
  final String name;
  final String path;
  final FileType type;
  final int size;
  final DateTime modified;

  const FileInfo({
    required this.name,
    required this.path,
    required this.type,
    required this.size,
    required this.modified,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        'path': path,
        'type': type.name,
        'size': size,
        'modified': modified.toIso8601String(),
      };

  factory FileInfo.fromJson(Map<String, dynamic> json) {
    return FileInfo(
      name: json['name'] as String,
      path: json['path'] as String,
      type: FileType.fromString(json['type'] as String),
      size: json['size'] as int,
      modified: DateTime.parse(json['modified'] as String),
    );
  }

  @override
  String toString() => 'FileInfo($type: $path)';
}

enum FileType {
  file,
  directory,
  symlink;

  String get name => toString().split('.').last;

  static FileType fromString(String s) {
    return FileType.values.firstWhere(
      (t) => t.name == s,
      orElse: () => FileType.file,
    );
  }
}

class FileTree {
  final String rootPath;
  final List<FileInfo> files;

  const FileTree({required this.rootPath, required this.files});

  Map<String, dynamic> toJson() => {
        'rootPath': rootPath,
        'files': files.map((f) => f.toJson()).toList(),
      };
}
