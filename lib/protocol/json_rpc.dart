/// JSON-RPC 2.0 protocol models.
///
/// Defines the standard request/response/notification format used between
/// the WebView JavaScript layer and the Flutter Dart engine.
///
/// Both [MockEngine] and future [TermuxEngine] must conform to this protocol.
library;

import 'dart:convert';

// ---------------------------------------------------------------------------
// Error codes (JSON-RPC 2.0 reserved range + application codes)
// ---------------------------------------------------------------------------
class JsonRpcErrors {
  JsonRpcErrors._();

  /// Invalid JSON was received.
  static const int parseError = -32700;

  /// The requested method does not exist.
  static const int methodNotFound = -32601;

  /// Invalid method parameters.
  static const int invalidParams = -32602;

  /// Application-level: permission denied.
  static const int permissionDenied = -32001;

  /// Application-level: file not found.
  static const int fileNotFound = -32002;

  /// Application-level: internal engine error.
  static const int internalError = -32603;
}

// ---------------------------------------------------------------------------
// JSON-RPC Request
// ---------------------------------------------------------------------------
class JsonRpcRequest {
  final String jsonrpc;
  final int? id; // null for notifications
  final String method;
  final Map<String, dynamic> params;

  const JsonRpcRequest({
    required this.jsonrpc,
    this.id,
    required this.method,
    this.params = const {},
  });

  /// Create a request with a generated id.
  factory JsonRpcRequest.create({
    required int id,
    required String method,
    Map<String, dynamic> params = const {},
  }) {
    return JsonRpcRequest(
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params,
    );
  }

  /// Create a notification (no id, no response expected).
  factory JsonRpcRequest.notification({
    required String method,
    Map<String, dynamic> params = const {},
  }) {
    return JsonRpcRequest(
      jsonrpc: '2.0',
      method: method,
      params: params,
    );
  }

  bool get isNotification => id == null;

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'jsonrpc': jsonrpc,
      'method': method,
    };
    if (id != null) map['id'] = id;
    if (params.isNotEmpty) map['params'] = params;
    return map;
  }

  factory JsonRpcRequest.fromJson(Map<String, dynamic> json) {
    return JsonRpcRequest(
      jsonrpc: json['jsonrpc'] as String? ?? '2.0',
      id: json['id'] as int?,
      method: json['method'] as String,
      params: (json['params'] as Map<String, dynamic>?) ?? {},
    );
  }

  String encode() => jsonEncode(toJson());

  @override
  String toString() => 'JsonRpcRequest(id: $id, method: $method, params: $params)';
}

// ---------------------------------------------------------------------------
// JSON-RPC Response
// ---------------------------------------------------------------------------
class JsonRpcResponse {
  final String jsonrpc;
  final int id;
  final dynamic result;
  final JsonRpcError? error;

  const JsonRpcResponse({
    required this.jsonrpc,
    required this.id,
    this.result,
    this.error,
  });

  bool get isError => error != null;
  bool get isSuccess => error == null;

  factory JsonRpcResponse.success({
    required int id,
    required dynamic result,
  }) {
    return JsonRpcResponse(
      jsonrpc: '2.0',
      id: id,
      result: result,
    );
  }

  factory JsonRpcResponse.error({
    required int id,
    required int code,
    required String message,
    dynamic data,
  }) {
    return JsonRpcResponse(
      jsonrpc: '2.0',
      id: id,
      error: JsonRpcError(code: code, message: message, data: data),
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'jsonrpc': jsonrpc,
      'id': id,
    };
    if (error != null) {
      map['error'] = error!.toJson();
    } else {
      map['result'] = result;
    }
    return map;
  }

  factory JsonRpcResponse.fromJson(Map<String, dynamic> json) {
    return JsonRpcResponse(
      jsonrpc: json['jsonrpc'] as String? ?? '2.0',
      id: json['id'] as int,
      result: json['result'],
      error: json['error'] != null
          ? JsonRpcError.fromJson(json['error'] as Map<String, dynamic>)
          : null,
    );
  }

  String encode() => jsonEncode(toJson());

  @override
  String toString() {
    if (isError) {
      return 'JsonRpcResponse(id: $id, error: ${error!.code} ${error!.message})';
    }
    return 'JsonRpcResponse(id: $id, result: $result)';
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC Error object
// ---------------------------------------------------------------------------
class JsonRpcError {
  final int code;
  final String message;
  final dynamic data;

  const JsonRpcError({
    required this.code,
    required this.message,
    this.data,
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'code': code,
      'message': message,
    };
    if (data != null) map['data'] = data;
    return map;
  }

  factory JsonRpcError.fromJson(Map<String, dynamic> json) {
    return JsonRpcError(
      code: json['code'] as int,
      message: json['message'] as String,
      data: json['data'],
    );
  }
}

// ---------------------------------------------------------------------------
// File change notification (application-specific)
// ---------------------------------------------------------------------------
class FileChangeEvent {
  final String path;
  final String type; // 'created', 'modified', 'deleted'

  const FileChangeEvent({
    required this.path,
    required this.type,
  });

  Map<String, dynamic> toJson() => {
        'path': path,
        'type': type,
      };

  factory FileChangeEvent.fromJson(Map<String, dynamic> json) {
    return FileChangeEvent(
      path: json['path'] as String,
      type: json['type'] as String,
    );
  }

  /// Convert to a pushFileChange notification.
  JsonRpcRequest toNotification() {
    return JsonRpcRequest.notification(
      method: 'pushFileChange',
      params: toJson(),
    );
  }

  @override
  String toString() => 'FileChangeEvent($type: $path)';
}
