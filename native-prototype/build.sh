#!/bin/sh
set -eu
mode=build
out_arg=""
case "${1:-}" in
  --typecheck)
    [ "$#" -eq 1 ] || { echo "Usage: build.sh --typecheck" >&2; exit 2; }
    mode=typecheck
    ;;
  --verify)
    [ "$#" -le 2 ] || { echo "Usage: build.sh --verify [bundle-path]" >&2; exit 2; }
  mode=verify
    out_arg=${2:-}
    ;;
  "") ;;
  -* ) echo "Unknown option: $1" >&2; exit 2 ;;
  *)
    [ "$#" -eq 1 ] || { echo "Usage: build.sh [bundle-path]" >&2; exit 2; }
    out_arg=$1
    ;;
esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
default_out="$root/native-prototype/build/GPTLimitsNativePrototype.app"
if [ "$mode" = build ]; then
  if [ -n "$out_arg" ]; then out=$out_arg
  else
    staging_dir=$(mktemp -d /private/tmp/GPTLimitsTool-build.XXXXXX)
    out="$staging_dir/GPTLimitsNativePrototype.app"
  fi
elif [ "$mode" = verify ]; then out=${out_arg:-$default_out}
else out="$default_out"
fi
main="$root/native-prototype/Main.swift"
manifest="$root/extension/manifest.json"
version=$(sed -n 's/^[[:space:]]*let gptLimitsAppVersion="\([^"]*\)".*/\1/p' "$main" | head -n 1)
expected_version=6.2.3
[ -n "$version" ] || { echo "Build failed: native runtime version marker missing." >&2; exit 1; }
[ "$version" = "$expected_version" ] || { echo "Build failed: expected native v$expected_version, found v$version." >&2; exit 1; }
python3 - "$manifest" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: m=json.load(f)
if m.get('version')!='0.2.0' or m.get('version_name')!='0.2.0-beta':
    raise SystemExit('Build failed: extension version must remain 0.2.0-beta (manifest version 0.2.0).')
PY

resources="$out/Contents/Resources"
executable="$out/Contents/MacOS/GPTLimitsNativePrototype"
icon="$root/native-prototype/AppIcon.icns"
[ -f "$icon" ] || { echo "Build failed: required final app icon missing at $icon." >&2; exit 1; }
input_files="$root/native-prototype/build.sh $main $root/native-prototype/CycleModel.swift $root/native-prototype/CycleEngine.swift $root/native-prototype/SingleInstanceLock.swift $root/native-prototype/RuntimeIdentity.swift $root/native-prototype/bridge.js $root/native-prototype/list-hook.js $root/native-prototype/conversation-list.js $root/native-prototype/automation-bridge.js $root/native-prototype/activity-hook.js $root/native-prototype/conversation-history-diagnostic.js $root/native-prototype/native-rescue-bridge.js $root/extension/rescue.js $root/extension/aggregator.js $root/extension/history-collector.js $root/extension/page-hook.js $manifest"
input_files="$input_files $icon"
build_id=$(shasum -a 256 $input_files | shasum -a 256 | awk '{print substr($1,1,16)}')

if [ "$mode" = typecheck ]; then
  tmp_metadata="/private/tmp/GPTLimitsBuildMetadata.typecheck.$$.swift"
  trap 'rm -f "$tmp_metadata"' EXIT HUP INT TERM
  cat > "$tmp_metadata" <<SWIFT
let gptLimitsExecutableBuildVersionMarker = "$version"
let gptLimitsExecutableBuildIDMarker = "$build_id"
SWIFT
  xcrun swiftc -typecheck -module-cache-path /private/tmp/gpt-limits-swift-cache "$main" "$root/native-prototype/CycleModel.swift" "$root/native-prototype/CycleEngine.swift" "$root/native-prototype/SingleInstanceLock.swift" "$root/native-prototype/RuntimeIdentity.swift" "$tmp_metadata" -framework AppKit -framework WebKit -framework UserNotifications
  echo "Native Swift typecheck passed: v$version · build $build_id"
  exit 0
fi

verify_bundle() {
  [ -x "$executable" ] || { echo "Freshness check failed: executable missing or not runnable." >&2; return 1; }
  [ -f "$out/Contents/Info.plist" ] || { echo "Freshness check failed: Info.plist missing." >&2; return 1; }
  actual_version=$(/usr/libexec/PlistBuddy -c 'Print :GPTLimitsBuildVersion' "$out/Contents/Info.plist" 2>/dev/null || true)
  actual_id=$(/usr/libexec/PlistBuddy -c 'Print :GPTLimitsBuildID' "$out/Contents/Info.plist" 2>/dev/null || true)
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$out/Contents/Info.plist" 2>/dev/null || true)
  bundle_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$out/Contents/Info.plist" 2>/dev/null || true)
  display_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$out/Contents/Info.plist" 2>/dev/null || true)
  [ "$bundle_id" = "com.alexandrast.gptlimitstool" ] || { echo "Freshness check failed: unexpected bundle identifier '$bundle_id'." >&2; return 1; }
  [ "$bundle_name" = "GPT Limits Tool" ] || { echo "Freshness check failed: bundle name is '$bundle_name'." >&2; return 1; }
  [ "$display_name" = "GPT Limits Tool" ] || { echo "Freshness check failed: display name is '$display_name'." >&2; return 1; }
  [ "$actual_version" = "$version" ] || { echo "Freshness check failed: bundle version is '$actual_version', expected '$version'." >&2; return 1; }
  [ "$actual_id" = "$build_id" ] || { echo "Freshness check failed: build ID is stale (bundle $actual_id, source $build_id)." >&2; return 1; }
  for file in aggregator.js history-collector.js page-hook.js rescue.js bridge.js list-hook.js conversation-list.js automation-bridge.js activity-hook.js conversation-history-diagnostic.js native-rescue-bridge.js; do
    source="$root/extension/$file"
    case "$file" in bridge.js|list-hook.js|conversation-list.js|automation-bridge.js|activity-hook.js|conversation-history-diagnostic.js|native-rescue-bridge.js) source="$root/native-prototype/$file";; esac
    [ -f "$resources/$file" ] && cmp -s "$source" "$resources/$file" || { echo "Freshness check failed: bundled resource '$file' differs from source." >&2; return 1; }
  done
  [ -f "$resources/AppIcon.icns" ] && cmp -s "$icon" "$resources/AppIcon.icns" || { echo "Freshness check failed: bundled AppIcon.icns differs from source." >&2; return 1; }
  icon_ref=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$out/Contents/Info.plist" 2>/dev/null || true)
  [ "$icon_ref" = "AppIcon.icns" ] || { echo "Freshness check failed: app icon plist reference is missing or incorrect." >&2; return 1; }
  /usr/bin/strings "$executable" | grep -Fq "$version" || { echo "Freshness check failed: executable does not contain runtime version marker v$version." >&2; return 1; }
  /usr/bin/strings "$executable" | grep -Fq "$build_id" || { echo "Freshness check failed: executable build ID does not match current sources." >&2; return 1; }
  /usr/bin/codesign --verify --deep --strict "$out" >/dev/null 2>&1 || { echo "Freshness check failed: bundle signature verification failed." >&2; return 1; }
  echo "Freshness check passed: v$version · build $build_id"
}

if [ "$mode" = verify ]; then
  verify_bundle
  exit $?
fi

mkdir -p "$out/Contents/MacOS"
rm -rf "$resources"
mkdir -p "$resources"
tmp_executable="$out/Contents/MacOS/.GPTLimitsNativePrototype.build.tmp.$$"
tmp_metadata="/private/tmp/GPTLimitsBuildMetadata.$$.swift"
trap 'rm -f "$tmp_executable" "$tmp_metadata"' EXIT HUP INT TERM
cat > "$tmp_metadata" <<SWIFT
let gptLimitsExecutableBuildVersionMarker = "$version"
let gptLimitsExecutableBuildIDMarker = "$build_id"
SWIFT
xcrun swiftc -module-cache-path /private/tmp/gpt-limits-swift-cache "$main" "$root/native-prototype/CycleModel.swift" "$root/native-prototype/CycleEngine.swift" "$root/native-prototype/SingleInstanceLock.swift" "$root/native-prototype/RuntimeIdentity.swift" "$tmp_metadata" -framework AppKit -framework WebKit -framework UserNotifications -o "$tmp_executable"
for file in aggregator.js history-collector.js page-hook.js rescue.js; do cp "$root/extension/$file" "$resources/$file"; done
cp "$root/native-prototype/bridge.js" "$resources/bridge.js"
for file in list-hook.js conversation-list.js automation-bridge.js activity-hook.js conversation-history-diagnostic.js native-rescue-bridge.js; do cp "$root/native-prototype/$file" "$resources/$file"; done
cp "$icon" "$resources/AppIcon.icns"
mv -f "$tmp_executable" "$executable"
trap - EXIT HUP INT TERM
built_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
cat > "$out/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>GPTLimitsNativePrototype</string>
<key>CFBundleIdentifier</key><string>com.alexandrast.gptlimitstool</string>
<key>CFBundleName</key><string>GPT Limits Tool</string>
<key>CFBundleDisplayName</key><string>GPT Limits Tool</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>__VERSION__</string>
<key>CFBundleVersion</key><string>__VERSION__</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>GPTLimitsBuildVersion</key><string>__VERSION__</string>
<key>GPTLimitsBuildID</key><string>__BUILD_ID__</string>
<key>GPTLimitsBuildTimestampUTC</key><string>__BUILT_AT__</string>
PLIST
printf '%s\n' '<key>CFBundleIconFile</key><string>AppIcon.icns</string>' >> "$out/Contents/Info.plist"
cat >> "$out/Contents/Info.plist" <<'PLIST'
</dict></plist>
PLIST
/usr/bin/sed -i '' -e "s/__VERSION__/$version/g" -e "s/__BUILD_ID__/$build_id/g" -e "s/__BUILT_AT__/$built_at/g" "$out/Contents/Info.plist"
printf 'APPL????' > "$out/Contents/PkgInfo"
/usr/bin/plutil -lint "$out/Contents/Info.plist" >/dev/null
# The synced workspace may attach Finder/FileProvider metadata to generated output.
# Remove filesystem metadata from this disposable bundle only before signing.
xattr -cr "$out"
find "$out" -name '._*' -type f -delete
/usr/bin/codesign --force --deep --sign - "$out" >/dev/null
verify_bundle
printf 'Built stable app: %s\nBuild timestamp UTC: %s\n' "$out" "$built_at"
