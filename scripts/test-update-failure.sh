#!/bin/bash
# Exercises the remote update flow of scripts/install.sh against real systemd:
# a failed or tampered download must leave the running install untouched, and
# a run that fails later must be recoverable by running the installer again.
#
# Runs as root INSIDE the container built from
# docker/Dockerfile.integration-test. It replaces /opt/snapcast-manager and the
# snapmanager unit, so never run it on a real host. The network is replaced by
# curl and wget stubs on PATH. The "release" is a small stub whose own installer
# only records how it was called, except where a test ships the real installer
# as its second half, with npm and node stubbed.
#
# Usage: bash scripts/test-update-failure.sh [path/to/install.sh]

set -uo pipefail

INSTALLER="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.sh}"
INSTALL_DIR=/opt/snapcast-manager
PREVIOUS_DIR="${INSTALL_DIR}.previous"
UNIT=/etc/systemd/system/snapmanager.service
VERSION=v9.9.9
OLD_VERSION=1.0.0

if [ "$(id -u)" -ne 0 ] || [ ! -d /run/systemd/system ]; then
    echo "Run this as root inside the systemd test container." >&2
    exit 2
fi

WORK=$(mktemp -d /var/tmp/update-failure-test.XXXXXX)
chmod 755 "$WORK"
cp "$INSTALLER" "$WORK/install.sh"
OUTPUT="$WORK/output"
pass=0
fail=0

ok() { echo "  PASS: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
check() {
    local description="$1"
    shift
    if "$@"; then ok "$description"; else bad "$description"; fi
}

# ---- Fake GitHub ----
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<STUB
#!/bin/bash
for arg in "\$@"; do
    case "\$arg" in
        https://api.github.com/*)
            [ -f "$WORK/release.json" ] && cat "$WORK/release.json"
            exit 0
            ;;
    esac
done
exec /usr/bin/curl "\$@"
STUB
cat > "$WORK/bin/wget" <<STUB
#!/bin/bash
# wget -qO <file> <url>
target="\$2"
url="\${3:-}"
case "\$url" in
    *releases/download*) [ -f "$WORK/asset.zip" ] && exec cp "$WORK/asset.zip" "\$target" ;;
    *archive/refs/tags*) [ -f "$WORK/source.zip" ] && exec cp "$WORK/source.zip" "\$target" ;;
esac
exit 8
STUB
chmod +x "$WORK/bin/curl" "$WORK/bin/wget"

if ! command -v zip >/dev/null || ! command -v unzip >/dev/null; then
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq zip unzip >/dev/null 2>&1
fi

# Builds a stub release at $1. Its installer exits with $2 and records its args.
# On success it cleans up the way a current installer's second half does.
make_release_zip() {
    local out="$1" stage2_status="${2:-0}" tree="$WORK/tree"
    rm -rf "$tree" "$out"
    mkdir -p "$tree/scripts" "$tree/server/dist" "$tree/client/dist"
    printf '{\n  "version": "%s"\n}\n' "${VERSION#v}" > "$tree/server/package.json"
    cat > "$tree/scripts/install.sh" <<STUB
#!/bin/bash
# Second half stub. Knows about .update-incomplete, like a current release.
echo "\$*" > "$WORK/stage2-args"
pwd > "$WORK/stage2-cwd"
if [ -d "$PREVIOUS_DIR" ]; then touch "$WORK/stage2-saw-previous"; fi
if [ "$stage2_status" -eq 0 ]; then rm -rf "$PREVIOUS_DIR" "$INSTALL_DIR/.update-incomplete"; fi
exit $stage2_status
STUB
    (cd "$tree" && zip -qr "$out" .)
}

# Same tree, with a stub installer from a release that knows nothing about
# finishing an update.
make_old_release_zip() {
    make_release_zip "$1"
    cat > "$WORK/tree/scripts/install.sh" <<STUB
#!/bin/bash
echo "\$*" > "$WORK/stage2-args"
pwd > "$WORK/stage2-cwd"
STUB
    rm -f "$1"
    (cd "$WORK/tree" && zip -qr "$1" .)
}

# Same tree, with the installer under test as the second half.
make_real_second_half_zip() {
    make_release_zip "$1"
    cp "$WORK/install.sh" "$WORK/tree/scripts/install.sh"
    rm -f "$1"
    (cd "$WORK/tree" && zip -qr "$1" .)
}

# Publishes $1 as the release asset, with the size and digest of file $2.
publish_asset() {
    local asset="$1" described="${2:-$1}" size digest
    size=$(stat -c %s "$described")
    digest=$(sha256sum "$described" | cut -d ' ' -f 1)
    cp "$asset" "$WORK/asset.zip"
    cat > "$WORK/release.json" <<JSON
{
  "tag_name": "$VERSION",
  "name": "$VERSION",
  "assets": [
    {
      "name": "snapcast-manager-release.zip",
      "size": $size,
      "digest": "sha256:$digest",
      "browser_download_url": "https://github.com/x/y/releases/download/$VERSION/snapcast-manager-release.zip"
    }
  ]
}
JSON
}

# ---- A running install ----
reset_install() {
    systemctl stop snapmanager 2>/dev/null || true
    rm -rf "$INSTALL_DIR" "$INSTALL_DIR".new.* "$INSTALL_DIR".old.* "$PREVIOUS_DIR"
    rm -rf /tmp/snapmgr_* /tmp/snapmanager.zip /tmp/snapserver_conf_backup /tmp/snapcast-manager-update.*
    rm -f "$WORK/release.json" "$WORK/asset.zip" "$WORK/source.zip" "$WORK/stage2-args" "$WORK/stage2-cwd" \
        "$WORK/stage2-saw-previous"
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/server/snapshots"
    echo "the database" > "$INSTALL_DIR/data/snapmanager.db"
    chmod 700 "$INSTALL_DIR/data"
    echo "a snapshot" > "$INSTALL_DIR/server/snapshots/one.tar.gz"
    printf '{\n  "version": "%s"\n}\n' "$OLD_VERSION" > "$INSTALL_DIR/server/package.json"
    printf 'PORT=8124\nSNAPCAST_MODE=client\nNODE_ENV=production\nJWT_SECRET=hand-added\n' > "$INSTALL_DIR/server/.env"
    chmod 600 "$INSTALL_DIR/server/.env"
    cat > "$UNIT" <<UNIT
[Unit]
Description=Stub of the old version
[Service]
ExecStart=/bin/sleep infinity
[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now snapmanager >/dev/null 2>&1
    OLD_PID=$(systemctl show -p MainPID --value snapmanager)
    OLD_TREE=$(tree_hash)
}

tree_hash() {
    (cd "$INSTALL_DIR" && find . -type f -exec sha256sum {} + | sort -k 2; find . -printf '%p %m %u\n' | sort) | sha256sum
}

# Runs the installer the way `curl | bash` does.
run_update() {
    (
        cd "$WORK" || exit 1
        cat install.sh | env PATH="$WORK/bin:$PATH" SNAPCAST_MANAGER_VERSION="$VERSION" \
            setsid bash -s -- -y "$@"
    ) > "$OUTPUT" 2>&1 < /dev/null
}

no_leftovers() {
    local found
    found=$(ls -d "$INSTALL_DIR".new.* "$INSTALL_DIR".old.* "$PREVIOUS_DIR" /tmp/snapmgr_* /tmp/snapmanager.zip \
        /tmp/snapcast-manager-update.* 2>/dev/null || true)
    [ -z "$found" ] || { echo "    left behind: $found"; return 1; }
}

expect_untouched() {
    local status="$1"
    check "installer reports failure" [ "$status" -ne 0 ]
    check "old version still running (same process)" \
        [ "$(systemctl show -p MainPID --value snapmanager)" = "$OLD_PID" ]
    check "service still enabled" systemctl is-enabled --quiet snapmanager
    check "install tree unchanged" [ "$(tree_hash)" = "$OLD_TREE" ]
    check "nothing left behind" no_leftovers
    check "says the installed version was not changed" grep -q "not changed" "$OUTPUT"
}

make_release_zip "$WORK/good.zip"

echo "== download fails, both the asset and the source archive"
reset_install
publish_asset "$WORK/good.zip"
rm -f "$WORK/asset.zip"
run_update; status=$?
expect_untouched "$status"

echo "== GitHub API unreachable and no download works"
reset_install
run_update; status=$?
expect_untouched "$status"

echo "== tampered archive: same size, wrong hash"
reset_install
cp "$WORK/good.zip" "$WORK/tampered.zip"
printf 'X' | dd of="$WORK/tampered.zip" bs=1 seek=40 conv=notrunc 2>/dev/null
publish_asset "$WORK/tampered.zip" "$WORK/good.zip"
run_update; status=$?
expect_untouched "$status"
check "reports the failed verification" grep -q "failed verification" "$OUTPUT"

echo "== truncated download: wrong size"
reset_install
head -c 100 "$WORK/good.zip" > "$WORK/short.zip"
publish_asset "$WORK/short.zip" "$WORK/good.zip"
run_update; status=$?
expect_untouched "$status"

echo "== unverifiable source archive that is not a zip"
reset_install
echo "not a zip" > "$WORK/source.zip"
run_update; status=$?
expect_untouched "$status"

echo "== verified archive that is not a release"
reset_install
rm -rf "$WORK/not-release" && mkdir "$WORK/not-release" && echo hi > "$WORK/not-release/readme"
(cd "$WORK/not-release" && zip -qr "$WORK/not-release.zip" .)
publish_asset "$WORK/not-release.zip"
run_update; status=$?
expect_untouched "$status"

echo "== database copy fails after the service stopped"
reset_install
publish_asset "$WORK/good.zip"
cat > "$WORK/bin/cp" <<STUB
#!/bin/bash
case "\$*" in *"$INSTALL_DIR/data"*) exit 1 ;; esac
exec /bin/cp "\$@"
STUB
chmod +x "$WORK/bin/cp"
run_update; status=$?
rm -f "$WORK/bin/cp"
check "installer reports failure" [ "$status" -ne 0 ]
check "old version running again" systemctl is-active --quiet snapmanager
check "install tree unchanged" [ "$(tree_hash)" = "$OLD_TREE" ]
check "nothing left behind" no_leftovers

echo "== successful update"
reset_install
publish_asset "$WORK/good.zip"
run_update; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "second half ran from the install" [ "$(cat "$WORK/stage2-cwd" 2>/dev/null)" = "$INSTALL_DIR" ]
check "second half got the saved port" grep -q -- "--port 8124" "$WORK/stage2-args"
check "second half got the saved mode" grep -q -- "--mode client" "$WORK/stage2-args"
check "database carried over" grep -q "the database" "$INSTALL_DIR/data/snapmanager.db"
check "new version in place" grep -q "${VERSION#v}" "$INSTALL_DIR/server/package.json"
check "snapshots carried over" grep -q "a snapshot" "$INSTALL_DIR/server/snapshots/one.tar.gz"
check "hand-added .env value carried over" grep -q '^JWT_SECRET=hand-added$' "$INSTALL_DIR/server/.env"
check ".env has one port" [ "$(grep -c '^PORT=' "$INSTALL_DIR/server/.env")" = 1 ]
check "old version kept for the second half" [ -f "$WORK/stage2-saw-previous" ]
check "nothing left behind" no_leftovers

echo "== update to a release that cannot finish an update"
reset_install
make_old_release_zip "$WORK/old-release.zip"
publish_asset "$WORK/old-release.zip"
run_update; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "no marker it could never remove" [ ! -e "$INSTALL_DIR/.update-incomplete" ]
check "nothing left behind" no_leftovers

echo "== real second half succeeds"
reset_install
make_real_second_half_zip "$WORK/real.zip"
publish_asset "$WORK/real.zip"
mkdir -p "$WORK/stubs"
printf '#!/bin/bash\nexit 0\n' > "$WORK/stubs/npm"
printf '#!/bin/bash\nexit 0\n' > "$WORK/stubs/node"
chmod +x "$WORK/stubs/npm" "$WORK/stubs/node"
env PATH="$WORK/stubs:$PATH" bash -c "$(declare -f run_update); WORK='$WORK' OUTPUT='$OUTPUT' VERSION='$VERSION' run_update --no-service"
status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "second half keeps the saved port" grep -q '^PORT=8124$' "$INSTALL_DIR/server/.env"
check "second half keeps hand-added values" grep -q '^JWT_SECRET=hand-added$' "$INSTALL_DIR/server/.env"
check "marker removed" [ ! -e "$INSTALL_DIR/.update-incomplete" ]
check "nothing left behind" no_leftovers

echo "== real second half fails, so the old version comes back"
reset_install
publish_asset "$WORK/real.zip"
printf '#!/bin/bash\nexit 1\n' > "$WORK/stubs/npm"
env PATH="$WORK/stubs:$PATH" APP_WAIT_SECONDS=1 bash -c "$(declare -f run_update); WORK='$WORK' OUTPUT='$OUTPUT' VERSION='$VERSION' run_update"
status=$?
check "installer reports failure" [ "$status" -ne 0 ]
check "old version running again" systemctl is-active --quiet snapmanager
check "service enabled again" systemctl is-enabled --quiet snapmanager
check "old unit in place" grep -q "Stub of the old version" "$UNIT"
check "install tree unchanged" [ "$(tree_hash)" = "$OLD_TREE" ]
check "nothing left behind" no_leftovers
check "says it went back" grep -q "previous version was restored" "$OUTPUT"

echo "== second half fails, then the installer is run again"
reset_install
make_release_zip "$WORK/stage2-fails.zip" 1
publish_asset "$WORK/stage2-fails.zip"
run_update; status=$?
check "first run reports failure" [ "$status" -ne 0 ]
check "database kept" grep -q "the database" "$INSTALL_DIR/data/snapmanager.db"
check "port saved on disk" grep -q '^PORT=8124$' "$INSTALL_DIR/server/.env"
check "mode saved on disk" grep -q '^SNAPCAST_MODE=client$' "$INSTALL_DIR/server/.env"
rm -f "$WORK/stage2-args"
publish_asset "$WORK/good.zip"
run_update; status=$?
check "re-run succeeds" [ "$status" -eq 0 ]
check "re-run does not stop at 'already up to date'" [ -f "$WORK/stage2-args" ]
check "re-run keeps the port" grep -q -- "--port 8124" "$WORK/stage2-args" 
check "re-run keeps the mode" grep -q -- "--mode client" "$WORK/stage2-args"
check "database still there" grep -q "the database" "$INSTALL_DIR/data/snapmanager.db"
check "last good version cleaned up" no_leftovers

echo "== killed between the two renames"
reset_install
publish_asset "$WORK/good.zip"
mkdir -m 700 "$PREVIOUS_DIR"
systemctl stop snapmanager
mv -T "$INSTALL_DIR" "$PREVIOUS_DIR/install"
run_update; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "treated as an update, port kept" grep -q -- "--port 8124" "$WORK/stage2-args"
check "database found" grep -q "the database" "$INSTALL_DIR/data/snapmanager.db"
check "nothing left behind" no_leftovers

echo "== database stranded in /tmp by an older installer"
reset_install
publish_asset "$WORK/good.zip"
rm -rf "${INSTALL_DIR:?}/data"
mkdir /tmp/snapmgr_data_backup
echo "stranded" > /tmp/snapmgr_data_backup/snapmanager.db
run_update; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "root-owned backup restored" grep -q "stranded" "$INSTALL_DIR/data/snapmanager.db"
check "backup removed once restored" [ ! -e /tmp/snapmgr_data_backup ]

echo "== planted /tmp paths are ignored"
reset_install
publish_asset "$WORK/good.zip"
rm -rf "${INSTALL_DIR:?}/data"
mkdir /tmp/snapmgr_data_backup
echo "planted" > /tmp/snapmgr_data_backup/snapmanager.db
chown -R nobody /tmp/snapmgr_data_backup
run_update; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
if grep -qs "planted" "$INSTALL_DIR/data/snapmanager.db"; then
    bad "planted database was restored"
else
    ok "planted database not restored"
fi
rm -rf /tmp/snapmgr_data_backup

echo "== clean re-install, chosen from the menu on a terminal"
reset_install
publish_asset "$WORK/good.zip"
(
    cd "$WORK" || exit 1
    # Other options, clean re-install, confirm, mode 2, port 9000.
    printf 'o\n2\ny\n2\n9000\n' | env PATH="$WORK/bin:$PATH" SNAPCAST_MANAGER_VERSION="$VERSION" \
        script -qec "bash install.sh" /dev/null
) > "$OUTPUT" 2>&1
status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "database not kept" [ ! -e "$INSTALL_DIR/data/snapmanager.db" ]
check "new port passed on" grep -q -- "--port 9000" "$WORK/stage2-args"
check "new mode passed on" grep -q -- "--mode server" "$WORK/stage2-args"
check "new settings saved" grep -q '^PORT=9000$' "$INSTALL_DIR/server/.env"
check "hand-added values not kept" [ "$(grep -c JWT_SECRET "$INSTALL_DIR/server/.env")" = 0 ]
check "snapshots not kept" [ ! -e "$INSTALL_DIR/server/snapshots/one.tar.gz" ]
check "old version not kept" [ ! -f "$WORK/stage2-saw-previous" ]
check "nothing left behind" no_leftovers

echo "== fresh install"
reset_install
systemctl disable --now snapmanager >/dev/null 2>&1
rm -f "$UNIT"
systemctl daemon-reload
rm -rf "$INSTALL_DIR"
publish_asset "$WORK/good.zip"
run_update --no-service; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "second half ran from the install" [ "$(cat "$WORK/stage2-cwd" 2>/dev/null)" = "$INSTALL_DIR" ]
check "install readable by others" [ "$(stat -c %a "$INSTALL_DIR")" = 755 ]
check "nothing left behind" no_leftovers

echo "== as a non-root user with sudo: tampered, then successful"
id tester >/dev/null 2>&1 || useradd -m tester
echo 'tester ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tester
reset_install
publish_asset "$WORK/tampered.zip" "$WORK/good.zip"
chmod -R a+rX "$WORK"
run_as_tester() {
    (
        cd /home/tester || exit 1
        cat "$WORK/install.sh" | runuser -u tester -- env USER=tester PATH="$WORK/bin:$PATH" \
            SNAPCAST_MANAGER_VERSION="$VERSION" setsid bash -s -- -y
    ) > "$OUTPUT" 2>&1 < /dev/null
}
run_as_tester; status=$?
expect_untouched "$status"
reset_install
publish_asset "$WORK/good.zip"
chmod -R a+rX "$WORK"
chmod a+w "$WORK"
run_as_tester; status=$?
check "installer succeeds" [ "$status" -eq 0 ]
check "database carried over from a private directory" grep -q "the database" "$INSTALL_DIR/data/snapmanager.db"
check "port kept" grep -q -- "--port 8124" "$WORK/stage2-args"
rm -f /etc/sudoers.d/tester

systemctl stop snapmanager 2>/dev/null || true
echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
