#!/usr/bin/env bash
# ============================================================
# STARK TELECOMMUNICATION — one-command APK builder
#
# Usage (from the repo root):
#   chmod +x build-apk.sh
#   ./build-apk.sh
#
# Output:
#   stark-flutter/build/app/outputs/flutter-apk/app-debug.apk
#
# Every step is idempotent: existing Stark files are never
# overwritten — flutter create only materializes MISSING platform
# files (gradlew, gradle-wrapper.jar, local.properties).
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { printf "\n${CYAN}▸ %s${NC}\n" "$1"; }
ok()   { printf "${GREEN}✓ %s${NC}\n" "$1"; }
warn() { printf "${YELLOW}⚠ %s${NC}\n" "$1"; }

# --- Preflight ------------------------------------------------
command -v flutter >/dev/null 2>&1 || { echo "flutter not found — install from flutter.dev and add it to PATH."; exit 1; }
command -v java    >/dev/null 2>&1 || warn "java not found — AGP 8.x needs JDK 17 (sudo apt install openjdk-17-jdk)"

step "1/5 · Materializing Android platform + Gradle wrapper"
cd "$(dirname "$0")/stark-flutter"
flutter create --platforms=android --project-name stark_telecom --org app.stark . >/dev/null
ok "android/ shell + gradlew present (existing files untouched)"

step "2/5 · Resolving dependencies"
flutter pub get >/dev/null && ok "pub get complete"

step "3/5 · Generating Freezed / Drift / JSON code"
dart run build_runner build --delete-conflicting-outputs >/dev/null && ok "code generation complete"

step "4/5 · Building debug APK (first run takes a few minutes)"
flutter build apk --debug

step "5/5 · Done"
APK="build/app/outputs/flutter-apk/app-debug.apk"
ok "APK built: $(pwd)/$APK"
printf "\n${GREEN}Install on a phone:${NC}\n"
printf "  adb install %s\n" "$APK"
printf "  — or copy the file to the device and tap it (enable USB/unknown-source installs).\n\n"
