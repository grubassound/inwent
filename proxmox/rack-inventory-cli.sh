#!/usr/bin/env bash
# Zarządzanie Rack Inventory w kontenerze: rack-inventory {update|passwd|backup|status|repair}
# Instalowane jako /usr/local/bin/rack-inventory przez proxmox/ct-install.sh i odświeżane przy każdym update.
set -euo pipefail
umask 022   # pliki aplikacji muszą być czytelne dla użytkownika usługi (rack)
APP_DIR=/opt/rack-inventory
[[ $EUID -eq 0 ]] || { echo "Uruchom jako root."; exit 1; }
cd "$APP_DIR"

# Kod aplikacji: czytelny dla usługi. .env (hasła) i kopie bazy: tylko dla właściciela.
fix_perms() {
  find "$APP_DIR" -path "$APP_DIR/.env" -prune -o -path "$APP_DIR/backups" -prune -o -exec chmod go+rX {} +
  chmod 600 "$APP_DIR/.env"
  [[ -d "$APP_DIR/backups" ]] && chmod 700 "$APP_DIR/backups"
  return 0
}
# Restart i sprawdzenie, że aplikacja odpowiada; przy błędzie pokazuje log.
restart_check() {
  systemctl restart rack-inventory
  for _ in $(seq 20); do
    sleep 1
    code="$(curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1/api/health || true)"
    [[ "$code" == 200 || "$code" == 401 ]] && return 0
  done
  echo "Aplikacja nie odpowiada po restarcie. Ostatnie wpisy w logu:"
  journalctl -u rack-inventory -n 15 --no-pager
  return 1
}
# Przed aktualizacją: czy jest połączenie z GitHubem? Jeśli nie, podpowiedz dlaczego.
check_network() {
  git ls-remote -q origin HEAD >/dev/null 2>&1 && return 0
  local url host
  url="$(git remote get-url origin)"
  host="$(sed -E 's#^[a-z+]+://([^/@]*@)?([^/:]+).*#\2#' <<<"$url")"
  echo "Brak połączenia z repozytorium ($url)."
  if ! ip route | grep -q '^default'; then
    echo "  Kontener nie ma bramy (default route). Na węźle Proxmox: pct set <ID> -net0 …,gw=<brama> i restart kontenera."
  elif ! getent hosts "$host" >/dev/null; then
    echo "  Nie działa DNS. Na węźle Proxmox: pct set <ID> -nameserver <serwer DNS> i restart kontenera."
  else
    echo "  Sieć i DNS działają, ale $host nie odpowiada. Spróbuj ponownie za chwilę."
  fi
  exit 1
}

case "${1:-}" in
  update)
    check_network
    bash "$APP_DIR/backup.sh"
    git pull -q --ff-only
    npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
    fix_perms
    restart_check
    # odśwież samo polecenie (rename, żeby nie podmieniać pliku, który właśnie się wykonuje)
    if [[ -f "$APP_DIR/proxmox/rack-inventory-cli.sh" ]]; then
      install -m 755 "$APP_DIR/proxmox/rack-inventory-cli.sh" /usr/local/bin/.rack-inventory.new
      mv -f /usr/local/bin/.rack-inventory.new /usr/local/bin/rack-inventory
    fi
    echo "Zaktualizowano do $(git rev-parse --short HEAD)." ;;
  passwd)
    read -r -p "Login [$(sed -n "s/^AUTH_USER='\(.*\)'$/\1/p" .env)]: " U
    while :; do
      read -r -s -p "Nowe hasło: " P1; echo; read -r -s -p "Powtórz hasło: " P2; echo
      [[ "$P1" == "$P2" ]] || { echo "Hasła się różnią."; continue; }
      [[ ${#P1} -ge 8 ]] || { echo "Hasło musi mieć co najmniej 8 znaków."; continue; }
      [[ "$P1" != *"'"* ]] || { echo "Hasło nie może zawierać apostrofu."; continue; }
      break
    done
    [[ "$U" != *"'"* ]] || { echo "Login nie może zawierać apostrofu."; exit 1; }
    # Nowe wartości idą przez zmienne środowiskowe, więc znaki specjalne w haśle niczego nie psują.
    # umask 077 tylko tutaj: plik tymczasowy z hasłami nie może być czytelny dla innych.
    ( umask 077
      NEW_USER="$U" NEW_PASS="$P1" awk 'BEGIN{q="\047"}
        /^AUTH_USER=/ && ENVIRON["NEW_USER"] != "" {print "AUTH_USER=" q ENVIRON["NEW_USER"] q; next}
        /^AUTH_PASSWORD=/ {print "AUTH_PASSWORD=" q ENVIRON["NEW_PASS"] q; next}
        {print}' .env > .env.tmp
      cat .env.tmp > .env   # cat zachowuje właściciela i uprawnienia 600
      rm -f .env.tmp )
    restart_check
    echo "Hasło zmienione. Wszyscy zostali wylogowani." ;;
  backup) bash "$APP_DIR/backup.sh" ;;
  repair)
    fix_perms
    restart_check
    echo "Uprawnienia poprawione, aplikacja działa." ;;
  status)
    systemctl --no-pager status rack-inventory | head -5
    echo "Wersja: $(git rev-parse --short HEAD)"
    echo "Adres: https://$(hostname -I | awk '{print $1}')/" ;;
  *) echo "Użycie: rack-inventory {update|passwd|backup|status|repair}"; exit 1 ;;
esac
