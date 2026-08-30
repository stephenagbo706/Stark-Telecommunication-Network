// STARK Identity — registration uniqueness & multi-device sign-in (Flutter side).
//
// RULE: one account per email AND per phone. Flutter normalizes inputs and
// pre-checks for friendly UX ONLY — the Go API + PostgreSQL unique indexes
// are the final authority (§29). A racing duplicate surfaces as
// ACCOUNT_EXISTS / PHONE_ALREADY_REGISTERED from the API, never a crash.
//
// Signing in from a new device registers the device + session and binds the
// FCM token — it NEVER creates a second account (§16).
import 'package:dio/dio.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core.dart';

/// Server error codes (§9–§12). Match the Go backend exactly.
enum IdentityErrorCode {
  accountExists,            // ACCOUNT_EXISTS
  phoneAlreadyRegistered,   // PHONE_ALREADY_REGISTERED
  identityConflict,         // IDENTITY_CONFLICT
  accountFrozen,            // ACCOUNT_FROZEN
  accountSuspended,         // ACCOUNT_SUSPENDED
  unknown,
}

class IdentityException implements Exception {
  IdentityException(this.code, this.message);
  final IdentityErrorCode code;
  final String message;

  /// Registration duplicates should route the user to Sign In (§9–§10).
  bool get shouldRedirectToLogin =>
      code == IdentityErrorCode.accountExists ||
      code == IdentityErrorCode.phoneAlreadyRegistered;

  @override
  String toString() => message;
}

class IdentityService {
  IdentityService(this._api);
  final ApiClient _api;

  /* ------------------------- normalization ------------------------- */

  /// Trim + lowercase — "Clark@Example.com" ≡ "clark@example.com" (§5).
  String normalizeEmail(String raw) =>
      raw.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '');

  bool isValidEmail(String email) =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$').hasMatch(normalizeEmail(email));

  /// Canonical Nigerian form +234XXXXXXXXXX (§6). Returns null if invalid.
  String? normalizePhone(String raw) {
    var d = raw.replaceAll(RegExp(r'\D'), '');
    if (d.startsWith('00234')) {
      d = d.substring(3);
    } else if (d.length == 13 && d.startsWith('234')) {
      d = d.substring(3);
    } else if (d.length == 11 && d.startsWith('0')) {
      d = d.substring(1);
    }
    if (d.length != 10) return null;
    if (!RegExp(r'^[789]\d{9}$').hasMatch(d)) return null;
    return '+234$d';
  }

  String formatPhone(String canonical) {
    final d = canonical.replaceAll(RegExp(r'\D'), '');
    final sub = d.substring(3);
    return '+234 ${sub.substring(0, 3)} ${sub.substring(3, 7)} ${sub.substring(7)}';
  }

  /* -------------------------- registration -------------------------- */

  /// POST /api/v1/auth/register/v2 — the server makes the final uniqueness
  /// decision; we map its error codes to actionable UI states.
  Future<String> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    String? referralCode,
  }) async {
    final emailNorm = normalizeEmail(email);
    final phoneNorm = normalizePhone(phone);
    if (!isValidEmail(email)) {
      throw IdentityException(IdentityErrorCode.unknown, 'Enter a valid email address.');
    }
    if (phoneNorm == null) {
      throw IdentityException(IdentityErrorCode.unknown,
          'Enter a valid Nigerian phone number, e.g. 0803 000 0000.');
    }

    try {
      final res = await _api.dio.post('/api/v1/auth/register/v2',  {
        'full_name': fullName.trim(),
        'email': emailNorm,
        'phone_number': phoneNorm,
        'password': password,
        if (referralCode != null) 'referral_code': referralCode,
      });
      final data = dataOf(res);
      return data['user_id'] as String;
    } on DioException catch (e) {
      throw _mapApiError(e);
    }
  }

  /* ----------------------------- login ------------------------------ */

  /// POST /api/v1/auth/login/v2 — email OR phone. A new device creates a
  /// device + session row server-side; the same immutable user id is kept.
  Future<StarkLogin> login({
    required String identifier,
    required String password,
    required String deviceId,
    required String deviceName,
    required String platform,
  }) async {
    String? fcmToken;
    try {
      fcmToken = await FirebaseMessaging.instance.getToken();
    } catch (_) {
      fcmToken = null; // push unavailable — login must still succeed
    }

    try {
      final res = await _api.dio.post('/api/v1/auth/login/v2',  {
        'identifier': identifier.contains('@') ? normalizeEmail(identifier) : (normalizePhone(identifier) ?? identifier),
        'password': password,
        'device_id': deviceId,
        'device_name': deviceName,
        'platform': platform,
        if (fcmToken != null) 'fcm_token': fcmToken,
      });
      final data = dataOf(res);
      final tokens = data['tokens'] as Map<String, dynamic>;
      await SecureStore.saveTokens(tokens['access_token'], tokens['refresh_token']);
      return StarkLogin(
        userId: data['user_id'] as String,
        newDevice: data['new_device'] == true,
      );
    } on DioException catch (e) {
      throw _mapApiError(e);
    }
  }

  /* ---------------------------- sessions ---------------------------- */

  Future<List<Map<String, dynamic>>> sessions() async {
    final res = await _api.dio.get('/api/v1/auth/sessions');
    final list = dataOf(res)['sessions'] as List<dynamic>? ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// DELETE /api/v1/auth/sessions/{id} — backend verifies ownership (§22).
  Future<void> revokeSession(String sessionId) =>
      _api.dio.delete('/api/v1/auth/sessions/$sessionId');

  /// Rebind the FCM token for this device (rotation / reinstall).
  /// Safe to call even when Firebase is not configured — it no-ops, so a
  /// missing google-services.json never breaks login or session flows.
  Future<void> registerFcmToken(String deviceId) async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      await _api.dio.post('/api/v1/devices/fcm-token',
           {'device_id': deviceId, 'fcm_token': token});
    } catch (_) {
      // Firebase unavailable on this build — skip push registration.
    }
  }

  /* ------------------------- error mapping -------------------------- */

  IdentityException _mapApiError(DioException e) {
    final body = e.response?.data;
    final code = (body is Map ? body['code'] : null)?.toString() ?? '';
    final message = (body is Map ? body['message'] : null)?.toString();

    switch (code) {
      case 'ACCOUNT_EXISTS':
        return IdentityException(IdentityErrorCode.accountExists,
            message ?? 'An account with this email already exists. Please sign in.');
      case 'PHONE_ALREADY_REGISTERED':
        return IdentityException(IdentityErrorCode.phoneAlreadyRegistered,
            message ?? 'This phone number is already registered. Please sign in.');
      case 'IDENTITY_CONFLICT':
        return IdentityException(IdentityErrorCode.identityConflict,
            message ?? 'This email and phone number belong to different accounts. Contact Stark Support.');
      case 'ACCOUNT_FROZEN':
        return IdentityException(IdentityErrorCode.accountFrozen,
            message ?? 'This account is frozen. Contact support to recover it.');
      case 'ACCOUNT_SUSPENDED':
        return IdentityException(IdentityErrorCode.accountSuspended,
            message ?? 'This account is suspended. Contact support for details.');
      default:
        return IdentityException(IdentityErrorCode.unknown,
            errorMessageOf(e, 'We couldn’t complete that. Check your details and retry.'));
    }
  }
}

class StarkLogin {
  StarkLogin({required this.userId, required this.newDevice});
  final String userId;
  final bool newDevice; // true ⇒ first sign-in from this device (§20)
}

final identityServiceProvider =
    Provider((ref) => IdentityService(ref.watch(apiClientProvider)));
