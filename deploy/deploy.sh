#!/usr/bin/env bash
# christianastrology.org: one-command install / update / rollback on an Ubuntu/Debian VPS.
# Run from inside an uploaded copy of the project (e.g. /tmp/christ):
#
#   sudo bash deploy/deploy.sh install  --domain christianastrology.org --email owner@example.com
#   sudo bash deploy/deploy.sh update
#   sudo bash deploy/deploy.sh rollback
#   sudo bash deploy/deploy.sh status
#
# Idempotent: re-running install is safe. update backs up code + database first and
# rolls back automatically if the new version fails its health check.
set -euo pipefail

APP_DIR=/var/www/christianastrology
APP_USER=christ
SERVICE=christianastrology
BACKUP_DIR=/var/backups/christianastrology
PORT=3000
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DOMAIN=""; EMAIL=""
CMD="${1:-help}"; shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo."
[[ -f "$SRC/server.js" && -f "$SRC/package.json" ]] || die "Run this from the project folder (server.js not found in $SRC)."

RSYNC_EXCLUDES=(--exclude node_modules --exclude .env --exclude '.claude' --exclude '.git'
                --exclude 'data/app.db' --exclude 'data/app.db-*' --exclude 'data/backups')

as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $*"; }

health() {
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

sync_code() {
  if [[ "$SRC" != "$APP_DIR" ]]; then
    # --delete removes files dropped from the project; excluded paths (.env, database) are never touched.
    rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC/" "$APP_DIR/" || return 1
  fi
  cd "$APP_DIR"
  npm ci --omit=dev --no-audit --no-fund --loglevel=error || return 1
  chown -R "$APP_USER:$APP_USER" "$APP_DIR" || return 1
  if [[ -f .env ]]; then chmod 600 .env || return 1; fi
  return 0
}

snapshot() {
  mkdir -p "$BACKUP_DIR"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  tar -czf "$BACKUP_DIR/code-$ts.tgz" -C "$APP_DIR" --exclude node_modules --exclude 'data/app.db*' --exclude data/backups .
  if [[ -f "$APP_DIR/data/app.db" ]]; then
    as_app "npm run -s backup" >/dev/null || die "Database backup failed; update stopped before changing code."
    ok "Database backed up (data/backups/)"
  fi
  ls -1t "$BACKUP_DIR"/code-*.tgz 2>/dev/null | tail -n +11 | xargs -r rm -f   # keep 10
  ok "Code snapshot $BACKUP_DIR/code-$ts.tgz"
}

env_get() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
# deploy/env.add (shipped with the package) holds the Printify settings this version was tested with (the old token
# expired). They replace the server's values for those keys only; nothing else in .env (Stripe key, email…) is touched.
env_merge() {
  local f="$SRC/deploy/env.add" k v n=0
  [[ -f "$f" && -f "$APP_DIR/.env" ]] || return 0
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Z0-9_]+= ]] || continue
    k="${line%%=*}"; v="${line#*=}"
    if [[ "$(env_get "$k")" != "$v" ]]; then
      if grep -qE "^$k=" "$APP_DIR/.env"; then
        python3 - "$APP_DIR/.env" "$k" "$v" <<'PYMERGE'
import sys
path, key, val = sys.argv[1:]
lines = open(path).read().splitlines()
open(path, "w").write("\n".join(f"{key}={val}" if l.startswith(key + "=") else l for l in lines) + "\n")
PYMERGE
      else
        printf '%s=%s\n' "$k" "$v" >> "$APP_DIR/.env"
      fi
      ok "Set $k in .env"; n=$((n + 1))
    fi
  done < "$f"
  (( n )) || ok "Server .env already matches env.add"
}
env_set() {
  if grep -qE "^$1=" "$APP_DIR/.env"; then sed -i "s|^$1=.*|$1=$2|" "$APP_DIR/.env"; else echo "$1=$2" >> "$APP_DIR/.env"; fi
}

case "$CMD" in
install)
  [[ -n "$DOMAIN" ]] || die "--domain is required (e.g. --domain christianastrology.org)"

  say "System packages"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx rsync curl ufw ca-certificates dnsutils >/dev/null
  if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) process.exit(1)' 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) process.exit(1)' || die "Node >= 22.13 required, found $(node -v)"
  ok "node $(node -v), nginx, certbot"

  say "App user and files"
  id "$APP_USER" >/dev/null 2>&1 || adduser --system --group --home "$APP_DIR" --no-create-home "$APP_USER" >/dev/null
  mkdir -p "$APP_DIR/data"
  sync_code
  ok "Code in $APP_DIR"

  if [[ ! -f "$APP_DIR/.env" ]]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    env_set APP_URL "https://$DOMAIN"
    env_set PORT "$PORT"
    env_set HOST 127.0.0.1
    [[ -n "$EMAIL" ]] && env_set ADMIN_EMAILS "$EMAIL"
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
    warn "Created $APP_DIR/.env from the template. Fill in Stripe, Printify and Resend keys, then: sudo bash deploy/deploy.sh update"
  fi
  env_merge
  [[ "$(env_get APP_URL)" == "https://$DOMAIN" ]] || warn "APP_URL in .env is '$(env_get APP_URL)', expected https://$DOMAIN"
  [[ -n "$(env_get ADMIN_EMAILS)" ]] || warn "ADMIN_EMAILS is empty in .env: nobody can reach /admin"

  say "systemd service"
  cp "$APP_DIR/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null 2>&1
  systemctl restart "$SERVICE"
  health && ok "App healthy on 127.0.0.1:$PORT" || { journalctl -u "$SERVICE" -n 40 --no-pager; die "App did not start. Log above."; }

  say "Nginx"
  sed "s/christianastrology\.org/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > "/etc/nginx/sites-available/$SERVICE"
  ln -sf "/etc/nginx/sites-available/$SERVICE" "/etc/nginx/sites-enabled/$SERVICE"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t -q && systemctl reload nginx
  ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null
  ok "Nginx serving $DOMAIN, firewall: SSH + HTTP/HTTPS only"

  say "HTTPS certificate"
  MYIP="$(curl -fsS -4 https://api.ipify.org 2>/dev/null || true)"
  DNSIP="$(dig +short A "$DOMAIN" | tail -1)"
  WWWIP="$(dig +short A "www.$DOMAIN" | tail -1)"
  if [[ -n "$MYIP" && "$MYIP" == "$DNSIP" ]]; then
    CERT_ARGS=(--nginx -n --agree-tos --redirect -d "$DOMAIN")
    if [[ "$WWWIP" == "$MYIP" ]]; then CERT_ARGS+=(-d "www.$DOMAIN"); else warn "www.$DOMAIN doesn't point here yet: certificate covers $DOMAIN only (rerun install later to add www)."; fi
    if [[ -n "$EMAIL" ]]; then CERT_ARGS+=(-m "$EMAIL"); else CERT_ARGS+=(--register-unsafely-without-email); fi
    certbot "${CERT_ARGS[@]}" && ok "Certificate installed (auto-renews)"
  else
    warn "DNS for $DOMAIN points to '${DNSIP:-nothing}', this server is '${MYIP:-unknown}'. Fix the Namecheap A records, wait, then rerun install."
  fi

  say "Nightly database backup"
  echo "15 3 * * * $APP_USER cd $APP_DIR && /usr/bin/npm run -s backup >/dev/null 2>&1" > /etc/cron.d/$SERVICE
  ok "/etc/cron.d/$SERVICE (03:15 daily, 14 days kept)"

  say "Integration check"
  as_app "npm run -s check" || warn "Some integrations need attention (see above)."
  ;;

update)
  [[ -d "$APP_DIR" ]] || die "Not installed yet. Run install first."
  say "Snapshot"
  snapshot
  say "Deploy new code"
  if sync_code && env_merge && systemctl restart "$SERVICE" && health; then
    ok "Updated and healthy"
    as_app "npm run -s check" || warn "Some integrations need attention (see above)."
  else
    warn "New version failed its health check. Rolling back."
    journalctl -u "$SERVICE" -n 30 --no-pager || true
    exec bash "$SRC/deploy/deploy.sh" rollback
  fi
  ;;

rollback)
  LATEST="$(ls -1t "$BACKUP_DIR"/code-*.tgz 2>/dev/null | head -1 || true)"
  [[ -n "$LATEST" ]] || die "No code snapshot in $BACKUP_DIR"
  say "Restoring $LATEST"
  find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data ! -name .env ! -name node_modules -exec rm -rf {} +
  tar -xzf "$LATEST" -C "$APP_DIR"
  cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  systemctl restart "$SERVICE"
  health && ok "Rolled back and healthy" || die "Still unhealthy after rollback: journalctl -u $SERVICE"
  warn "Database was not rolled back (it only grows). Copies are in $APP_DIR/data/backups if ever needed."
  ;;

status)
  systemctl --no-pager --lines=0 status "$SERVICE" || true
  curl -fsS "http://127.0.0.1:$PORT/healthz" && echo
  as_app "npm run -s check" || true
  ;;

*)
  sed -n '2,12p' "$0"
  ;;
esac
