#!/usr/bin/env bash
# Rack Inventory · instalacja w kontenerze LXC (albo na czystym Debianie 12), jako root.
# Uruchamiany automatycznie przez proxmox/rack-inventory.sh. Ręcznie:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/grubassound/inwent/main/proxmox/ct-install.sh)"
# Zmienne (opcjonalne): AUTH_USER, AUTH_PASSWORD, BRANCH, REPO
set -Eeuo pipefail

REPO="${REPO:-https://github.com/grubassound/inwent.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/rack-inventory
# Login i hasło: ze zmiennych, a przy ponownej instalacji z istniejącego .env; dopiero potem domyślne.
env_val() { [[ -f "$APP_DIR/.env" ]] && sed -n "s/^$1='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" "$APP_DIR/.env" || true; }
AUTH_USER="${AUTH_USER:-$(env_val AUTH_USER)}"; AUTH_USER="${AUTH_USER:-admin}"
AUTH_PASSWORD="${AUTH_PASSWORD:-$(env_val AUTH_PASSWORD)}"; AUTH_PASSWORD="${AUTH_PASSWORD:-adminadmin}"
APP_USER=rack
DB_NAME=rack_inventory
DB_USER=rack
export DEBIAN_FRONTEND=noninteractive NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; BL=$'\033[36m'; CL=$'\033[m'
msg_info() { printf ' %s…%s %s\n' "$BL" "$CL" "$1"; }
apt_q() { apt-get -y -qq -o Dpkg::Options::=--force-confold "$@" >/dev/null 2> >(grep -v '^debconf: delaying' >&2 || true); }
msg_ok()   { printf ' %s✓%s %s\n' "$GN" "$CL" "$1"; }
msg_err()  { printf ' %s✗%s %s\n' "$RD" "$CL" "$1" >&2; }
trap 'msg_err "Błąd w linii $LINENO: $BASH_COMMAND"; exit 1' ERR

[[ $EUID -eq 0 ]] || { msg_err "Uruchom jako root."; exit 1; }
. /etc/os-release
[[ "${ID:-}" == debian ]] || { msg_err "Ten instalator jest dla Debiana (wykryto: ${PRETTY_NAME:-?})."; exit 1; }
[[ "$AUTH_PASSWORD" != *"'"* && "$AUTH_USER" != *"'"* ]] || { msg_err "Login i hasło nie mogą zawierać apostrofu."; exit 1; }

msg_info "Aktualizacja systemu"
apt-get update -qq
apt_q upgrade
msg_ok "System zaktualizowany"

msg_info "Instalacja pakietów (MariaDB, Apache, git)"
apt_q install curl ca-certificates gnupg git openssl cron mariadb-server apache2
msg_ok "Pakiety zainstalowane"

if ! command -v node >/dev/null || (( $(node -p 'process.versions.node.split(".")[0]') < 18 )); then
  msg_info "Instalacja Node.js 22 LTS (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt_q install nodejs
fi
msg_ok "Node.js $(node -v)"

msg_info "Baza danych"
systemctl enable -q --now mariadb
DB_PASSWORD="$(env_val DB_PASSWORD)"; DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
mariadb <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
msg_ok "Baza $DB_NAME i użytkownik $DB_USER gotowe"

msg_info "Pobieranie aplikacji ($REPO, gałąź $BRANCH)"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
msg_ok "Aplikacja w $APP_DIR ($(git rev-parse --short HEAD))"

msg_info "Konfiguracja (.env)"
SESSION_SECRET="$(env_val SESSION_SECRET)"; SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
umask 077
cat > .env <<ENV
HOST='127.0.0.1'
PORT='3080'
DB_HOST='localhost'
DB_PORT='3306'
DB_NAME='$DB_NAME'
DB_USER='$DB_USER'
DB_PASSWORD='$DB_PASSWORD'
AUTH_USER='$AUTH_USER'
AUTH_PASSWORD='$AUTH_PASSWORD'
SESSION_SECRET='$SESSION_SECRET'
HISTORY_DAYS='0'
ENV
umask 022
chown "$APP_USER:$APP_USER" .env
chmod 600 .env
runuser -u "$APP_USER" -- node src/init-db.js >/dev/null
msg_ok "Konfiguracja zapisana, tabele utworzone"

msg_info "Usługa systemd"
cat > /etc/systemd/system/rack-inventory.service <<UNIT
[Unit]
Description=Rack Inventory (inwentaryzacja szafy sieciowej)
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q rack-inventory
systemctl restart rack-inventory
msg_ok "Usługa rack-inventory działa"

msg_info "Apache z HTTPS (certyfikat własny)"
IP="$(hostname -I | awk '{print $1}')"
CERT=/etc/ssl/certs/rack-inventory.crt KEY=/etc/ssl/private/rack-inventory.key
if [[ ! -f "$CERT" ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -sha256 -subj "/CN=${IP:-$(hostname)}/O=Rack Inventory" \
    -addext "subjectAltName=${IP:+IP:$IP,}DNS:$(hostname),DNS:$(hostname).local" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,digitalSignature,keyCertSign" -addext "extendedKeyUsage=serverAuth" \
    -keyout "$KEY" -out "$CERT" 2>/dev/null
  chmod 600 "$KEY"
fi
a2enmod -q proxy proxy_http headers ssl rewrite >/dev/null
cat > /etc/apache2/sites-available/rack-inventory.conf <<CONF
# Rack Inventory: cały kontener służy aplikacji. HTTP przekierowuje na HTTPS.
<VirtualHost *:80>
    RewriteEngine On
    RewriteRule ^/(.*)$ https://%{HTTP_HOST}/\$1 [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    SSLEngine on
    SSLCertificateFile    $CERT
    SSLCertificateKeyFile $KEY

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3080/ timeout=60
    ProxyPassReverse / http://127.0.0.1:3080/
    RequestHeader set X-Forwarded-Proto "https"
    LimitRequestBody 10485760

    ErrorLog  \${APACHE_LOG_DIR}/rack-inventory-error.log
    CustomLog \${APACHE_LOG_DIR}/rack-inventory-access.log combined
</VirtualHost>
CONF
echo "ServerName $(hostname)" > /etc/apache2/conf-available/servername.conf
a2enconf -q servername >/dev/null
a2dissite -q 000-default >/dev/null 2>&1 || true
a2ensite -q rack-inventory >/dev/null
apache2ctl configtest >/dev/null 2>&1
systemctl enable -q apache2
systemctl restart apache2
msg_ok "Apache: https://${IP:-$(hostname)}/"

msg_info "Kopie zapasowe i polecenie rack-inventory"
cat > /etc/cron.d/rack-inventory <<'CRON'
# Codzienna kopia bazy Rack Inventory (30 ostatnich w /opt/rack-inventory/backups)
15 2 * * * root bash /opt/rack-inventory/backup.sh >/dev/null 2>&1
CRON
cat > /usr/local/bin/rack-inventory <<'CLI'
#!/usr/bin/env bash
# Zarządzanie Rack Inventory w kontenerze: rack-inventory {update|passwd|backup|status}
set -euo pipefail
umask 077
APP_DIR=/opt/rack-inventory
[[ $EUID -eq 0 ]] || { echo "Uruchom jako root."; exit 1; }
case "${1:-}" in
  update)
    bash "$APP_DIR/backup.sh"
    git -C "$APP_DIR" pull -q --ff-only
    (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
    systemctl restart rack-inventory
    echo "Zaktualizowano do $(git -C "$APP_DIR" rev-parse --short HEAD)." ;;
  passwd)
    read -r -p "Login [$(sed -n "s/^AUTH_USER='\(.*\)'$/\1/p" "$APP_DIR/.env")]: " U
    while :; do
      read -r -s -p "Nowe hasło: " P1; echo; read -r -s -p "Powtórz hasło: " P2; echo
      [[ "$P1" == "$P2" ]] || { echo "Hasła się różnią."; continue; }
      [[ ${#P1} -ge 8 ]] || { echo "Hasło musi mieć co najmniej 8 znaków."; continue; }
      [[ "$P1" != *"'"* ]] || { echo "Hasło nie może zawierać apostrofu."; continue; }
      break
    done
    [[ "$U" != *"'"* ]] || { echo "Login nie może zawierać apostrofu."; exit 1; }
    # Nowe wartości idą przez zmienne środowiskowe, więc znaki specjalne w haśle niczego nie psują.
    NEW_USER="$U" NEW_PASS="$P1" awk 'BEGIN{q="\047"}
      /^AUTH_USER=/ && ENVIRON["NEW_USER"] != "" {print "AUTH_USER=" q ENVIRON["NEW_USER"] q; next}
      /^AUTH_PASSWORD=/ {print "AUTH_PASSWORD=" q ENVIRON["NEW_PASS"] q; next}
      {print}' "$APP_DIR/.env" > "$APP_DIR/.env.tmp"
    cat "$APP_DIR/.env.tmp" > "$APP_DIR/.env"   # cat zachowuje właściciela i uprawnienia 600
    rm -f "$APP_DIR/.env.tmp"
    systemctl restart rack-inventory
    echo "Hasło zmienione. Wszyscy zostali wylogowani." ;;
  backup) bash "$APP_DIR/backup.sh" ;;
  status)
    systemctl --no-pager status rack-inventory | head -5
    echo "Adres: https://$(hostname -I | awk '{print $1}')/" ;;
  *) echo "Użycie: rack-inventory {update|passwd|backup|status}"; exit 1 ;;
esac
CLI
chmod 755 /usr/local/bin/rack-inventory
msg_ok "Kopia codziennie o 2:15, polecenie: rack-inventory {update|passwd|backup|status}"

msg_info "Sprawdzenie działania"
for _ in $(seq 30); do
  curl -fsk -u "$AUTH_USER:$AUTH_PASSWORD" https://127.0.0.1/api/health 2>/dev/null | grep -q '"ok":true' && break
  sleep 1
done
curl -fsk -u "$AUTH_USER:$AUTH_PASSWORD" https://127.0.0.1/api/health | grep -q '"ok":true'
msg_ok "Aplikacja odpowiada przez HTTPS"

apt-get -y -qq autoremove >/dev/null; apt-get -y -qq clean
echo
printf '%s Rack Inventory jest gotowe:%s https://%s/\n' "$GN" "$CL" "${IP:-$(hostname)}"
printf '   Login: %s   Hasło: %s\n' "$AUTH_USER" "$AUTH_PASSWORD"
if [[ "$AUTH_PASSWORD" == adminadmin ]]; then
  printf '%s   To hasło domyślne, jest jawne w repozytorium. Zmień je poleceniem: rack-inventory passwd%s\n' "$YW" "$CL"
fi
