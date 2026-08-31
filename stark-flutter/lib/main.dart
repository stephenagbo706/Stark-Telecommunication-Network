// STARK Telecommunication — Flutter entrypoint.
// Boots Firebase (FCM), Riverpod and the GoRouter shell.
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/core.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait-first phone experience; landscape allowed on tablets.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Firebase is OPTIONAL at launch. If google-services.json has not been
  // added (android/app/), the app still boots — push delivery is simply
  // disabled until it is configured. Never let a missing push setup crash
  // the whole application (§44: do not remove Firebase; make it resilient).
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
    FirebaseMessaging.instance.requestPermission(
      alert: true, badge: true, sound: true, provisional: false,
    );
  } catch (_) {
    // Firebase not configured on this build. The app runs normally;
    // FCM registration in identity_service is already guarded.
  }

  // Dark status bar over the Stark navy canvas.
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));

  runApp(const ProviderScope(child: StarkApp()));
}

class StarkApp extends ConsumerWidget {
  const StarkApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(starkThemeModeProvider);
    return MaterialApp.router(
      title: 'STARK',
      debugShowCheckedModeBanner: false,
      theme: StarkTheme.light(),
      darkTheme: StarkTheme.dark(),
      themeMode: themeMode,
      routerConfig: ref.watch(appRouterProvider),
    );
  }
}
