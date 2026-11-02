#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_script="$root/native-prototype/build.sh"
build_app="$root/native-prototype/build/GPTLimitsNativePrototype.app"
bundle_id="com.alexandrast.gptlimitstool"
executable_name="GPTLimitsNativePrototype"
install_name="GPT Limits Tool.app"
test_mode=0

if [ "${1:-}" = "--test-root" ]; then
  test_mode=1
  install_root=${2:?Usage: install-local.sh --test-root /private/tmp/test-root [--build-app path]}
  case "$install_root" in /private/tmp/*) ;; *) echo "Test root must be under /private/tmp." >&2; exit 2;; esac
  shift 2
  if [ "${1:-}" = "--build-app" ]; then build_app=${2:?Missing test build app}; shift 2; fi
  [ "$#" -eq 0 ] || { echo "Unexpected installer arguments." >&2; exit 2; }
else
  [ "$#" -eq 0 ] || { echo "Usage: install-local.sh [--test-root /private/tmp/test-root [--build-app path]]" >&2; exit 2; }
  install_root=/Applications
fi

sh "$build_script" --verify "$build_app"
read_plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null; }
source_version=$(read_plist "$build_app" GPTLimitsBuildVersion)
source_build_id=$(read_plist "$build_app" GPTLimitsBuildID)
[ "$(read_plist "$build_app" CFBundleIdentifier)" = "$bundle_id" ] || { echo "Install refused: stable bundle identifier mismatch." >&2; exit 1; }
[ "$(read_plist "$build_app" CFBundleName)" = "GPT Limits Tool" ] || { echo "Install refused: stable bundle name mismatch." >&2; exit 1; }
[ "$(read_plist "$build_app" CFBundleDisplayName)" = "GPT Limits Tool" ] || { echo "Install refused: stable display name mismatch." >&2; exit 1; }
[ "$(read_plist "$build_app" CFBundleIconFile)" = "AppIcon.icns" ] || { echo "Install refused: stable app icon reference missing." >&2; exit 1; }
[ -f "$build_app/Contents/Resources/AppIcon.icns" ] || { echo "Install refused: stable AppIcon.icns missing." >&2; exit 1; }
install_app="$install_root/$install_name"

if [ "$test_mode" -eq 0 ]; then
build_executable="$build_app/Contents/MacOS/$executable_name"
installed_executable="$install_app/Contents/MacOS/$executable_name"
process_ids=$(pgrep -x "$executable_name" 2>/dev/null || true)
for pid in $process_ids; do
  process_executable=$(lsof -a -p "$pid" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)
  case "$process_executable" in
    "$build_executable"|"$installed_executable")
      echo "Stopping GPT Limits Tool process $pid from $process_executable"
      kill -TERM "$pid" 2>/dev/null || true
      attempts=0
      while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 20 ]; do
        sleep 0.25
        attempts=$((attempts+1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        current_executable=$(lsof -a -p "$pid" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)
        if [ "$current_executable" = "$build_executable" ] || [ "$current_executable" = "$installed_executable" ]; then kill -KILL "$pid" 2>/dev/null || true; fi
      fi
      ;;
    *) echo "Leaving unrelated process $pid untouched." ;;
  esac
done

fi

stage="$install_root/.GPT Limits Tool.app.staging.$$"
backup="$install_root/.GPT Limits Tool.app.backup.$$"
cleanup() {
  [ ! -e "$stage" ] || rm -rf "$stage"
  if [ -e "$backup" ] && [ ! -e "$install_app" ]; then mv "$backup" "$install_app"; fi
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$install_root"
[ ! -e "$stage" ] && [ ! -e "$backup" ] || { echo "Install refused: staging path already exists." >&2; exit 1; }
ditto --rsrc --extattr "$build_app" "$stage"
sh "$build_script" --verify "$stage"
if [ -e "$install_app" ]; then mv "$install_app" "$backup"; fi
if ! mv "$stage" "$install_app"; then
  [ ! -e "$backup" ] || mv "$backup" "$install_app"
  echo "Install failed while replacing the application." >&2
  exit 1
fi
if ! sh "$build_script" --verify "$install_app"; then
  rm -rf "$install_app"
  [ ! -e "$backup" ] || mv "$backup" "$install_app"
  echo "Install failed verification; previous app restored when available." >&2
  exit 1
fi
[ ! -e "$backup" ] || rm -rf "$backup"
trap - EXIT HUP INT TERM

if [ "$test_mode" -eq 1 ]; then
  echo "Test installation verified: $install_app · v$source_version · build $source_build_id"
  exit 0
fi


lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$lsregister" -f "$install_app"
ls_dump=$("$lsregister" -dump 2>/dev/null)
printf '%s\n' "$ls_dump" | grep -F "path:                       $install_app " >/dev/null || { echo "Install failed: LaunchServices did not register the installed bundle path." >&2; exit 1; }
open -n "$install_app"
echo "Installed and launched: $install_app · v$source_version · build $source_build_id"
echo "WebKit website data, preferences, and calibration storage were not modified."
