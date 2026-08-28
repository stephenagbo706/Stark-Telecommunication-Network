// ============================================================
// STARK Telecommunication — app module (Kotlin DSL)
//
// STARK-specific choices (each a deliberate, minimal deviation
// from the stock Flutter template):
//   • applicationId  app.stark.stark_telecom   (contract org app.stark)
//   • minSdk 23      — required floor for flutter_secure_storage,
//                      local_auth, firebase_messaging, mobile_scanner
//   • google-services plugin commented until google-services.json
//     is added (see android/settings.gradle)
// ============================================================

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // UNCOMMENT together with the matching line in android/settings.gradle
    // once android/app/google-services.json exists:
    // id("com.google.gms.google-services")
}

android {
    namespace = "app.stark.stark_telecom"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "app.stark.stark_telecom"
        // 23 (not the template's flutter.minSdkVersion) — the highest
        // minimum required by Stark's secure-storage / biometric /
        // push / scanner plugins. Raising it never breaks them.
        minSdk = 23
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO(stark): replace with a real release signing config
            // (key.properties + upload keystore) before store release.
            // Debug keys for now so `flutter run --release` also works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
