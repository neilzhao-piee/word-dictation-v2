#!/usr/bin/env bash
# Reproducible Android tweaks. `android/` is gitignored, so anything we change
# inside it must be re-appliable from this script after `npx cap add android`.
#
# Edge-to-edge: targetSdk 36 forces it on Android 15+; the app's white
# topbar renders underneath the (transparent) system bars, so the system clock/
# icons must use the DARK variants to stay readable. windowLightNavigationBar
# is API 27+ and simply ignored on older devices (minSdk 24).
#
# Per-app language: the 拍照/上传 buttons open Android's system photo picker, whose
# labels ("Take photo", "Choose from photos") follow the SYSTEM/per-app language,
# not our WebView i18n. Declaring localeConfig enables Android 13+ per-app
# language (Settings > Apps > Word Dictation V2 > Languages), which localizes
# system pickers launched from this app. Ignored on older Android.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/android/app/src/main/res/values/styles.xml"
[ -f "$RES" ] || { echo "missing $RES — run 'npx cap add android' first"; exit 1; }

if grep -q windowLightStatusBar "$RES"; then
  echo "already patched: $RES"
else
  sed -i \
    -e 's|<item name="colorAccent">@color/colorAccent</item>|&\n        <item name="android:windowLightStatusBar">true</item>\n        <item name="android:windowLightNavigationBar">true</item>|' \
    -e 's|<item name="android:background">@null</item>|&\n        <item name="android:windowLightStatusBar">true</item>\n        <item name="android:windowLightNavigationBar">true</item>|' \
    "$RES"
  grep -c windowLightStatusBar "$RES" | xargs -I{} echo "patched {} styles in $RES"
fi

# --- per-app language support ---
XML_DIR="$ROOT/android/app/src/main/res/xml"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
[ -f "$MANIFEST" ] || { echo "missing $MANIFEST"; exit 1; }
mkdir -p "$XML_DIR"
cat > "$XML_DIR/locales_config.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<locale-config xmlns:android="http://schemas.android.com/apk/res/android">
    <locale android:name="en"/>
    <locale android:name="zh-CN"/>
    <locale android:name="zh-TW"/>
    <locale android:name="ja"/>
    <locale android:name="ko"/>
</locale-config>
XML
if grep -q 'localeConfig' "$MANIFEST"; then
  echo "already patched: $MANIFEST"
else
  sed -i 's|android:theme="@style/AppTheme"|android:theme="@style/AppTheme"\n        android:localeConfig="@xml/locales_config"|' "$MANIFEST"
  grep -n 'localeConfig' "$MANIFEST"
  echo "patched localeConfig in $MANIFEST"
fi
