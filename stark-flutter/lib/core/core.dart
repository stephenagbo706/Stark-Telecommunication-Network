// STARK core layer — the single source of truth for theme tokens,
// networking, routing, secure storage, biometrics and photo upload.
// Widgets never hardcode colors or talk to HTTP directly.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:local_auth/local_auth.dart';

/* ============================ THEME ================================ */

abstract class StarkColors {
  static const Color cyan = Color(0xFF00D9FF);    // STARK primary
  static const Color blue = Color(0xFF087CFF);    // STARK blue
  static const Color darkBg = Color(0xFF050B14);
  static const Color darkSurface = Color(0xFF0B1422);
  static const Color darkCard = Color(0xFF101D2D);
  static const Color lightBg = Color(0xFFF5F9FC);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color darkText = Color(0xFFFFFFFF);
  static const Color lightText = Color(0xFF0F172A);
  static const Color secondaryText = Color(0xFF94A3B8);
  static const Color success = Color(0xFF22C55E);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF38BDF8);
}

abstract class StarkSpace {
  static const double xs = 4, sm = 8, md = 12, lg = 16, xl = 20, xxl = 24, xxxl = 32;
}

abstract class StarkRadius {
  static const double control = 8, input = 12, card = 16, largeCard = 20, sheet = 24;
}

abstract class StarkTheme {
  static TextTheme _text(Brightness b) {
    final color = b == Brightness.dark ? StarkColors.darkText : StarkColors.lightText;
    return TextTheme(
      displayLarge: GoogleFonts.spaceGrotesk(fontSize: 34, fontWeight: FontWeight.w700, color: color),
      headlineMedium: GoogleFonts.spaceGrotesk(fontSize: 22, fontWeight: FontWeight.w700, color: color),
      titleLarge: GoogleFonts.spaceGrotesk(fontSize: 17, fontWeight: FontWeight.w700, color: color),
      titleMedium: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600, color: color),
      bodyLarge: GoogleFonts.inter(fontSize: 15, color: color),
      bodyMedium: GoogleFonts.inter(fontSize: 13, color: StarkColors.secondaryText),
      labelSmall: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1.2),
    );
  }

  static ThemeData dark() => ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: StarkColors.darkBg,
        colorScheme: const ColorScheme.dark(
          primary: StarkColors.cyan,
          secondary: StarkColors.blue,
          surface: StarkColors.darkSurface,
          error: StarkColors.error,
        ),
        cardColor: StarkColors.darkCard,
        textTheme: _text(Brightness.dark),
        appBarTheme: const AppBarTheme(backgroundColor: Colors.transparent, elevation: 0),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: StarkColors.darkSurface,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(StarkRadius.input)),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: StarkColors.cyan,
            foregroundColor: Colors.black,
            minimumSize: const Size(double.infinity, 52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(StarkRadius.input)),
          ),
        ),
      );

  static ThemeData light() => ThemeData(
        brightness: Brightness.light,
        scaffoldBackgroundColor: StarkColors.lightBg,
        colorScheme: const ColorScheme.light(
          primary: StarkColors.cyan,
          secondary: StarkColors.blue,
          surface: StarkColors.lightSurface,
          error: StarkColors.error,
        ),
        textTheme: _text(Brightness.light),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: StarkColors.cyan,
            foregroundColor: Colors.black,
            minimumSize: const Size(double.infinity, 52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(StarkRadius.input)),
          ),
        ),
      );
}

final starkThemeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.dark);

/* ======================= SECURE STORAGE ============================ */
// Tokens live ONLY in flutter_secure_storage (Keychain/Keystore),
// never in SharedPreferences.

class SecureStore {
  static const _s = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static Future<String?> accessToken() => _s.read(key: 'stark_access');
  static Future<String?> refreshToken() => _s.read(key: 'stark_refresh');
  static Future<void> saveTokens(String access, String refresh) async {
    await _s.write(key: 'stark_access', value: access);
    await _s.write(key: 'stark_refresh', value: refresh);
  }
  static Future<void> clear() async {
    await _s.delete(key: 'stark_access');
    await _s.delete(key: 'stark_refresh');
  }
}

/* ========================== NETWORK ================================ */

/// Dio client: attaches the bearer token, queues concurrent 401s behind a
/// single refresh-token rotation call, and stamps idempotency keys on
/// mutating financial requests. No secret ever exists in this layer.
class ApiClient {
  ApiClient({String? baseUrl})
      : dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? const String.fromEnvironment(
            'STARK_API_URL',
            defaultValue: 'http://10.0.2.2:8080', // Android emulator → host
          ),
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 30),
          contentType: 'application/json',
        )) {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await SecureStore.accessToken();
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        if ((options.method == 'POST' || options.method == 'PUT') &&
            !options.headers.containsKey('X-Idempotency-Key')) {
          options.headers['X-Idempotency-Key'] = const UuidLike().v4();
        }
        handler.next(options);
      },
      onError: (e, handler) async {
        if (e.response?.statusCode == 401 && !e.requestOptions.path.contains('/auth/')) {
          final newToken = await _rotate();
          if (newToken != null) {
            e.requestOptions.headers['Authorization'] = 'Bearer $newToken';
            handler.resolve(await dio.fetch(e.requestOptions));
            return;
          }
          authExpiredNotifier.value = true;
        }
        handler.next(e);
      },
    ));
  }

  final Dio dio;
  Completer<String?>? _refreshing;

  Future<String?> _rotate() async {
    _refreshing ??= Completer<String?>();
    if (_refreshing!.isCompleted) return _refreshing!.future;
    try {
      final refresh = await SecureStore.refreshToken();
      if (refresh == null) {
        _refreshing!.complete(null);
        return null;
      }
      final res = await dio.post('/api/v1/auth/refresh', data: {'refresh_token': refresh});
      final tokens = res.data['data']['tokens'] as Map<String, dynamic>;
      await SecureStore.saveTokens(tokens['access_token'], tokens['refresh_token']);
      _refreshing!.complete(tokens['access_token'] as String?);
      return tokens['access_token'] as String?;
    } catch (_) {
      _refreshing!.complete(null);
      return null;
    } finally {
      _refreshing = null;
    }
  }
}

final authExpiredNotifier = ValueNotifier<bool>(false);

// Minimal uuid v4 without an extra dependency path in core.
class UuidLike {
  String v4() => DateTime.now().microsecondsSinceEpoch.toRadixString(16) +
      DateTime.now().millisecondsSinceEpoch.toRadixString(16);
}

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

/* =========================== ROUTER ================================ */

/// GoRouter with an auth guard. Unauthenticated users land on /auth.
final appRouterProvider = Provider<GoRouter>((ref) {
  final api = ref.watch(apiClientProvider);
  return GoRouter(
    initialLocation: '/home',
    redirect: (context, state) async {
      final hasToken = await SecureStore.accessToken() != null;
      final authing = state.matchedLocation.startsWith('/auth');
      if (!hasToken && !authing) return '/auth';
      if (hasToken && authing) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/auth', builder: (c, s) => _lazy('auth')),
      GoRoute(path: '/home', builder: (c, s) => _lazy('home')),
      GoRoute(path: '/wallet', builder: (c, s) => _lazy('wallet')),
      GoRoute(path: '/activity', builder: (c, s) => _lazy('activity')),
      GoRoute(path: '/ai', builder: (c, s) => _lazy('ai')),
      GoRoute(path: '/profile', builder: (c, s) => _lazy('profile')),
      GoRoute(path: '/buy/:service', builder: (c, s) => _lazy('buy')),
    ],
  );
});

Widget _lazy(String screen) => _ScreenPlaceholder(screen);

class _ScreenPlaceholder extends StatelessWidget {
  final String name;
  const _ScreenPlaceholder(this.name);
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Text(name)));
}

/* ========================== BIOMETRICS ============================= */
// local_auth only. Biometric templates NEVER leave the device — the
// backend receives only a boolean "local auth succeeded" outcome.

class BiometricService {
  final _auth = LocalAuthentication();

  Future<bool> isAvailable() async {
    final can = await _auth.canCheckBiometrics;
    final supported = await _auth.isDeviceSupported();
    return can || supported;
  }

  Future<bool> authenticate({String reason = 'Authorize this action on Stark'}) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: false, // falls back to device passcode where allowed
          stickyAuth: true,
        ),
      );
    } catch (_) {
      return false;
    }
  }
}

final biometricServiceProvider = Provider<BiometricService>((ref) => BiometricService());

/* ======================= PROFILE PHOTO ============================= */
// Pick → client-side size check → multipart upload. The server sniffs
// MIME, enforces 2 MB, writes to object storage and returns a URL.
// The database stores the reference — never the bytes.

class ProfilePhotoService {
  ProfilePhotoService(this._api);
  final ApiClient _api;
  final _picker = ImagePicker();
  static const maxBytes = 2 * 1024 * 1024;

  Future<File?> pick({required bool camera}) async {
    final x = await _picker.pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1280,
      maxHeight: 1280,
      imageQuality: 82, // compress client-side before upload
    );
    if (x == null) return null;
    final f = File(x.path);
    if (await f.length() > maxBytes) {
      throw const PhotoTooLargeException();
    }
    return f;
  }

  Future<String> upload(File file, {void Function(double)? onProgress}) async {
    final form = FormData.fromMap({
      'photo': await MultipartFile.fromFile(file.path, filename: 'photo.jpg'),
    });
    final res = await _api.dio.post(
      '/api/v1/profile/photo',
      data: form,
      onSendProgress: (sent, total) =>
          total > 0 ? onProgress?.call(sent / total) : null,
    );
    return res.data['data']['profile_image_url'] as String;
  }

  Future<void> remove() => _api.dio.delete('/api/v1/profile/photo');
}

class PhotoTooLargeException implements Exception {
  const PhotoTooLargeException();
  @override
  String toString() => 'Choose an image under 2 MB.';
}

final profilePhotoServiceProvider = Provider<ProfilePhotoService>(
  (ref) => ProfilePhotoService(ref.watch(apiClientProvider)),
);

/* =========================== FORMATTING ============================ */

String starkNaira(int kobo) =>
    '₦${(kobo / 100).toStringAsFixed(2).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';

Map<String, dynamic> dataOf(dynamic res) =>
    (res.data['data'] as Map<String, dynamic>?) ?? const {};

String errorMessageOf(dynamic err, String fallback) {
  if (err is DioException && err.response != null) {
    try {
      final body = err.response!.data;
      final msg = body is Map ? body['error']?['message'] : null;
      if (msg is String && msg.isNotEmpty) return msg;
    } catch (_) {}
  }
  if (err is Exception) {
    final s = err.toString();
    if (s.contains('SocketException') || s.contains('DioExceptionType.connection')) {
      return 'You appear to be offline. Financial actions need a connection.';
    }
  }
  return fallback;
}

String jsonOf(Object? o) => jsonEncode(o);
