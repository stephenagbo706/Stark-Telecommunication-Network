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

  await Firebase.initializeApp();
  FirebaseMessaging.instance.requestPermission(
    alert: true, badge: true, sound: true, provisional: false,
  );

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
