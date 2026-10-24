#!/usr/bin/env bash
# Rack Inventory · tworzy kontener LXC (Debian 12) w Proxmox VE i instaluje w nim gotową aplikację.
# Uruchom w powłoce węzła Proxmox (Shell w panelu WWW albo SSH), jako root:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/grubassound/inwent/main/proxmox/rack-inventory.sh)"
set -Eeuo pipefail

APP="Rack Inventory"
NSAPP="rack-inventory"
BRANCH="${BRANCH:-main}"
RAW="https://raw.githubusercontent.com/grubassound/inwent/${BRANCH}"

YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; BL=$'\033[36m'; BOLD=$'\033[1m'; CL=$'\033[m'
msg_info() { printf ' %s…%s %s\n' "$BL" "$CL" "$1"; }
msg_ok()   { printf ' %s✓%s %s\n' "$GN" "$CL" "$1"; }
msg_err()  { printf ' %s✗%s %s\n' "$RD" "$CL" "$1" >&2; }
CTID=""
on_error() {
  msg_err "Błąd w linii $1: $2"
  if [[ -n "$CTID" ]] && pct status "$CTID" >/dev/null 2>&1; then
    echo "   Kontener $CTID został zachowany do diagnozy. Usunięcie: pct stop $CTID; pct destroy $CTID"
  fi
  exit 1
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

header() {
  clear
  cat <<'ART'
    ____             __      ____                      __
   / __ \____ ______/ /__   /  _/___ _   _____  ____  / /_____  _______  __
  / /_/ / __ `/ ___/ //_/   / // __ \ | / / _ \/ __ \/ __/ __ \/ ___/ / / /
 / _, _/ /_/ / /__/ ,<    _/ // / / / |/ /  __/ / / / /_/ /_/ / /  / /_/ /
/_/ |_|\__,_/\___/_/|_|  /___/_/ /_/|___/\___/_/ /_/\__/\____/_/   \__, /
                                                                  /____/
ART
  echo "  Inwentaryzacja szaf sieciowych · kontener LXC dla Proxmox VE"
  echo
}

# ---------- sprawdzenia ----------
header
[[ $EUID -eq 0 ]] || { msg_err "Uruchom jako root na węźle Proxmox."; exit 1; }
command -v pveversion >/dev/null || { msg_err "To nie jest węzeł Proxmox VE (brak pveversion)."; exit 1; }
PVE_MAJOR="$(pveversion | sed -n 's|^pve-manager/\([0-9]\+\).*|\1|p')"
[[ "${PVE_MAJOR:-0}" -ge 7 ]] || { msg_err "Wymagany Proxmox VE 7 lub nowszy (wykryto: $(pveversion))."; exit 1; }
[[ "$(dpkg --print-architecture)" == amd64 ]] || { msg_err "Obsługiwana jest tylko architektura amd64."; exit 1; }
command -v whiptail >/dev/null || { msg_err "Brak whiptail (apt install whiptail)."; exit 1; }
msg_ok "Proxmox VE $(pveversion | sed -n 's|^pve-manager/\([^/ ]*\).*|\1|p')"

# ---------- ustawienia ----------
CTID="$(pvesh get /cluster/nextid)"
HN="$NSAPP"; DISK=4; CORES=1; RAM=1024; BRG=vmbr0; NET=dhcp; GATE=""; VLAN=""; UNPRIV=1
AUTH_USER="admin"; AUTH_PASSWORD="adminadmin"
WT=(--backtitle "$APP · Proxmox VE")

ask() { whiptail "${WT[@]}" --title "$1" --inputbox "$2" 10 64 "$3" 3>&1 1>&2 2>&3; }
cancel() { echo; msg_err "Przerwano."; exit 0; }

if whiptail "${WT[@]}" --title "$APP" --yesno \
  "Utworzyć kontener z ustawieniami domyślnymi?\n\n  ID: $CTID   Nazwa: $HN\n  Debian 12, ${CORES} rdzeń, ${RAM} MB RAM, dysk ${DISK} GB\n  Sieć: $BRG, DHCP\n  Logowanie do aplikacji: $AUTH_USER / $AUTH_PASSWORD\n\n„Nie” = ustawienia zaawansowane." 17 64; then
  :
else
  CTID="$(ask "ID kontenera" "Numer kontenera (CT ID):" "$CTID")" || cancel
  if pct status "$CTID" >/dev/null 2>&1 || qm status "$CTID" >/dev/null 2>&1; then msg_err "ID $CTID jest już zajęte."; exit 1; fi
  HN="$(ask "Nazwa" "Nazwa hosta kontenera:" "$HN")" || cancel
  DISK="$(ask "Dysk" "Rozmiar dysku w GB:" "$DISK")" || cancel
  CORES="$(ask "Procesor" "Liczba rdzeni:" "$CORES")" || cancel
  RAM="$(ask "Pamięć" "RAM w MB:" "$RAM")" || cancel
  BRG="$(ask "Sieć" "Mostek sieciowy:" "$BRG")" || cancel
  NET="$(ask "Adres IP" "dhcp albo stały adres z maską, np. 192.168.1.50/24:" "$NET")" || cancel
  if [[ "$NET" != dhcp ]]; then
    GATE="$(ask "Brama" "Adres bramy (wymagany przy stałym IP), np. 192.168.1.1:" "")" || cancel
    [[ "$GATE" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { msg_err "Przy stałym adresie IP podaj bramę, inaczej kontener nie będzie miał internetu."; exit 1; }
  fi
  VLAN="$(ask "VLAN" "Tag VLAN (puste = bez VLAN):" "")" || cancel
  AUTH_USER="$(ask "Logowanie" "Login do aplikacji:" "$AUTH_USER")" || cancel
  AUTH_PASSWORD="$(whiptail "${WT[@]}" --title "Logowanie" --passwordbox "Hasło do aplikacji (min. 8 znaków, Enter = adminadmin):" 10 64 3>&1 1>&2 2>&3)" || cancel
  AUTH_PASSWORD="${AUTH_PASSWORD:-adminadmin}"
fi
for v in DISK CORES RAM CTID; do [[ "${!v}" =~ ^[0-9]+$ ]] || { msg_err "$v musi być liczbą."; exit 1; }; done
[[ -z "$VLAN" || "$VLAN" =~ ^[0-9]+$ ]] || { msg_err "VLAN musi być liczbą."; exit 1; }
[[ "$NET" == dhcp || "$NET" =~ ^[0-9.]+/[0-9]+$ ]] || { msg_err "Adres IP podaj jako dhcp albo np. 192.168.1.50/24."; exit 1; }
[[ ${#AUTH_PASSWORD} -ge 8 && "$AUTH_PASSWORD" != *"'"* && "$AUTH_USER" != *"'"* && -n "$AUTH_USER" ]] \
  || { msg_err "Login nie może być pusty, hasło musi mieć min. 8 znaków; oba bez apostrofu."; exit 1; }

# Magazyn: jeśli jest kilka, pytamy; jeśli jeden – bierzemy go.
pick_storage() {
  local content="$1" title="$2" list=() line
  while read -r line; do
    local name free
    name="$(awk '{print $1}' <<<"$line")"
    free="$(awk '{printf "%.1f GB wolne", $6/1048576}' <<<"$line")"
    list+=("$name" "$free")
  done < <(pvesm status -content "$content" | awk 'NR>1 && $3=="active"')
  [[ ${#list[@]} -gt 0 ]] || { msg_err "Brak aktywnego magazynu na $content."; exit 1; }
  if [[ ${#list[@]} -eq 2 ]]; then echo "${list[0]}"; return; fi
  whiptail "${WT[@]}" --title "$title" --menu "Wybierz magazyn:" 16 60 6 "${list[@]}" 3>&1 1>&2 2>&3 || cancel
}
STORAGE="$(pick_storage rootdir "Dysk kontenera")"; [[ -n "$STORAGE" ]] || cancel
TSTORAGE="$(pick_storage vztmpl "Szablony kontenerów")"; [[ -n "$TSTORAGE" ]] || cancel
msg_ok "Magazyn: $STORAGE (dysk), $TSTORAGE (szablony)"

# ---------- szablon Debiana 12 ----------
msg_info "Szablon Debian 12"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system | awk '$2 ~ /^debian-12-standard_.*amd64/ {print $2}' | sort -V | tail -n1)"
[[ -n "$TEMPLATE" ]] || { msg_err "Nie znaleziono szablonu debian-12-standard (pveam available)."; exit 1; }
TEMPLATES_HERE="$(pveam list "$TSTORAGE")"
if ! grep -qF "$TEMPLATE" <<<"$TEMPLATES_HERE"; then
  pveam download "$TSTORAGE" "$TEMPLATE" >/dev/null
fi
msg_ok "Szablon $TEMPLATE"

# ---------- kontener ----------
msg_info "Tworzenie kontenera $CTID ($HN)"
NET0="name=eth0,bridge=$BRG,ip=$NET${GATE:+,gw=$GATE}${VLAN:+,tag=$VLAN}"
[[ "$NET" == dhcp ]] && NET0="$NET0,ip6=auto"
pct create "$CTID" "$TSTORAGE:vztmpl/$TEMPLATE" \
  -hostname "$HN" -cores "$CORES" -memory "$RAM" -swap 512 \
  -rootfs "$STORAGE:$DISK" -net0 "$NET0" \
  -unprivileged "$UNPRIV" -features nesting=1 -onboot 1 -ostype debian \
  -tags "$NSAPP" -description "Rack Inventory · https://github.com/grubassound/inwent" >/dev/null
msg_ok "Kontener $CTID utworzony"

msg_info "Uruchamianie kontenera"
pct start "$CTID"
for i in $(seq 60); do
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  [[ $i -eq 60 ]] && { msg_err "Kontener nie ma dostępu do internetu (DNS/brama). Sprawdź sieć i uruchom ponownie."; exit 1; }
  sleep 1
done
msg_ok "Kontener działa i ma dostęp do sieci"

# ---------- instalacja w kontenerze ----------
msg_info "Instalacja aplikacji w kontenerze (kilka minut)"
pct exec "$CTID" -- bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null"
pct exec "$CTID" -- curl -fsSL "$RAW/proxmox/ct-install.sh" -o /root/ct-install.sh
pct exec "$CTID" -- env AUTH_USER="$AUTH_USER" AUTH_PASSWORD="$AUTH_PASSWORD" BRANCH="$BRANCH" bash /root/ct-install.sh
pct exec "$CTID" -- rm -f /root/ct-install.sh

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
printf '%s%s gotowe!%s\n\n' "$GN" "$APP" "$CL"
printf '  Adres:      %shttps://%s/%s\n' "$BOLD" "$IP" "$CL"
printf '  Login:      %s\n  Hasło:      %s\n' "$AUTH_USER" "$AUTH_PASSWORD"
printf '  Kontener:   %s (%s)\n\n' "$CTID" "$HN"
echo "  Przeglądarka pokaże ostrzeżenie o certyfikacie (własny certyfikat w sieci lokalnej) – zaakceptuj je."
if [[ "$AUTH_PASSWORD" == adminadmin ]]; then
  printf '  %sZmień domyślne hasło:%s pct enter %s, potem: rack-inventory passwd\n' "$YW" "$CL" "$CTID"
fi
echo "  Aktualizacja aplikacji: pct exec $CTID -- rack-inventory update"
echo
