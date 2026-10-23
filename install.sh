#!/usr/bin/env bash
# Rack Inventory · instalator dla Ubuntu/Debian
# Uruchom z katalogu repozytorium:  bash install.sh
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"

c_ok(){ printf '\033[32m✓\033[0m %s\n' "$*"; }
c_info(){ printf '\033[36m•\033[0m %s\n' "$*"; }
c_err(){ printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
ask(){ local q="$1" def="${2:-}" a; read -r -p "$q${def:+ [$def]}: " a; echo "${a:-$def}"; }
# Hasła trafiają do .env w apostrofach, więc sam apostrof jest niedozwolony.
ask_secret(){
  local q="$1" a
  while :; do
    read -r -s -p "$q: " a; echo >&2
    [[ "$a" != *"'"* ]] && break
    c_err "Hasło nie może zawierać apostrofu (')."
  done
  echo "$a"
}
# Nazwa bazy i użytkownika idą do poleceń SQL, więc tylko litery, cyfry i podkreślnik.
ask_ident(){
  local q="$1" def="$2" a
  while :; do
    a="$(ask "$q" "$def")"
    [[ "$a" =~ ^[A-Za-z0-9_]{1,32}$ ]] && break
    c_err "Dozwolone są tylko litery, cyfry i podkreślnik (do 32 znaków)."
  done
  echo "$a"
}
# Bez apostrofów i znaków nowej linii, bo wartości trafiają do .env w apostrofach.
ask_plain(){
  local q="$1" def="${2:-}" a
  while :; do
    a="$(ask "$q" "$def")"
    [[ "$a" != *"'"* ]] && break
    c_err "Wartość nie może zawierać apostrofu (')."
  done
  echo "$a"
}
yes_no(){ local a; read -r -p "$1 [T/n]: " a; [[ -z "$a" || "$a" =~ ^[TtYy] ]]; }

echo
echo "  Rack Inventory · instalacja w $APP_DIR"
echo

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  c_err "Brak Node.js. Zainstaluj Node 18+ (np. sudo apt install nodejs npm albo z nodesource.com) i uruchom ponownie."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  c_err "Node.js $(node -v) jest za stary. Wymagany 18 lub nowszy."
  exit 1
fi
c_ok "Node.js $(node -v)"

# 2. Zależności
c_info "Instaluję zależności npm…"
npm install --omit=dev --no-audit --no-fund
c_ok "Zależności zainstalowane"

# 3. Konfiguracja .env (+ opcjonalnie baza i użytkownik MySQL)
if [[ -f .env ]]; then
  c_ok "Plik .env już istnieje, zostawiam go bez zmian"
else
  DB_HOST="$(ask_plain 'Host MySQL' 'localhost')"
  DB_PORT="$(ask_plain 'Port MySQL' '3306')"
  DB_NAME="$(ask_ident 'Nazwa bazy' 'rack_inventory')"
  DB_USER="$(ask_ident 'Użytkownik bazy' 'rack')"

  # `sudo mysql` działa tylko na tym serwerze, więc automatyczne zakładanie bazy tylko dla lokalnego MySQL.
  if [[ "$DB_HOST" == "localhost" || "$DB_HOST" == "127.0.0.1" ]] && yes_no "Utworzyć teraz bazę i użytkownika MySQL? (potrzebny dostęp: sudo mysql)"; then
    DB_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
    sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
    c_ok "Utworzono bazę $DB_NAME i użytkownika $DB_USER@localhost (hasło zapisane w .env)"
  else
    if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
      c_info "Baza jest na innym serwerze ($DB_HOST). Załóż ją tam ręcznie, patrz README → „Instalacja ręczna”."
    fi
    DB_PASSWORD="$(ask_secret 'Hasło użytkownika bazy')"
  fi

  HOST="$(ask_plain 'Adres nasłuchu aplikacji (127.0.0.1 za Apache/nginx, 0.0.0.0 dla całej sieci LAN bez serwera WWW)' '127.0.0.1')"
  PORT="$(ask_plain 'Port aplikacji' '3080')"
  AUTH_USER=""; AUTH_PASSWORD=""
  if yes_no "Włączyć logowanie (login i hasło do aplikacji)?"; then
    AUTH_USER="$(ask_plain 'Login' 'admin')"
    AUTH_PASSWORD="$(ask_secret 'Hasło do aplikacji')"
  elif [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
    c_info "Uwaga: bez logowania każdy w sieci może zmieniać i usuwać dane."
  fi

  # Wartości w apostrofach: dotenv czyta je dosłownie, więc # $ ` i spacje w hasłach są bezpieczne.
  umask 077
  cat > .env <<ENV
HOST='$HOST'
PORT='$PORT'
DB_HOST='$DB_HOST'
DB_PORT='$DB_PORT'
DB_NAME='$DB_NAME'
DB_USER='$DB_USER'
DB_PASSWORD='$DB_PASSWORD'
AUTH_USER='$AUTH_USER'
AUTH_PASSWORD='$AUTH_PASSWORD'
ENV
  umask 022
  c_ok "Zapisano .env (uprawnienia 600)"
fi

# 4. Tabele + układ racka
if yes_no "Wczytać układ racka z inwentaryzacji (16 urządzeń, tylko gdy baza jest pusta)?"; then
  npm run --silent db:seed
else
  npm run --silent db:init
fi

# 5. Usługa systemd
if command -v systemctl >/dev/null 2>&1 && yes_no "Zainstalować usługę systemd (autostart po restarcie serwera)?"; then
  RUN_USER="$(ask 'Użytkownik systemowy, na którym ma działać aplikacja' "${SUDO_USER:-$USER}")"
  NODE_BIN="$(command -v node)"
  sudo tee /etc/systemd/system/rack-inventory.service >/dev/null <<UNIT
[Unit]
Description=Rack Inventory (inwentaryzacja szafy sieciowej)
After=network.target mysql.service mariadb.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now rack-inventory
  sleep 1
  if systemctl is-active --quiet rack-inventory; then
    c_ok "Usługa rack-inventory działa"
  else
    c_err "Usługa nie wystartowała. Sprawdź: sudo journalctl -u rack-inventory -n 50"
  fi
else
  c_info "Uruchom ręcznie: npm start"
fi

PORT_SHOW="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d "'\"")"
HOST_SHOW="$(grep -E '^HOST=' .env | cut -d= -f2 | tr -d "'\"")"
echo
c_ok "Gotowe. Aplikacja: http://${HOST_SHOW/0.0.0.0/$(hostname -I 2>/dev/null | awk '{print $1}')}:${PORT_SHOW:-3080}"
echo "  Za Apache: deploy/apache.conf i sekcja „Apache, nginx i HTTPS” w README.md"
echo
