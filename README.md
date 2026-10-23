# Rack Inventory

Aplikacja webowa do inwentaryzacji szafy sieciowej. Opisujesz w niej każdy port patchpaneli i switchy: status, patchcord w racku (oba końce), dokąd prowadzi kabel, urządzenie końcowe, VLAN, kolor i długość kabla, etykietę, plan po przebudowie i notatki. Dane trzymane są w MySQL/MariaDB, a każda zmiana portu trafia do historii.

Stack: **Node.js 18+ · Express · MySQL 8 / MariaDB 10.5+**. Frontend to czysty HTML/CSS/JS bez kompilacji.

---

## Spis treści

1. [Co potrafi](#co-potrafi)
2. [Wymagania](#wymagania)
3. [Szybka instalacja (install.sh)](#szybka-instalacja)
4. [Instalacja ręczna krok po kroku](#instalacja-ręczna)
5. [nginx i HTTPS](#nginx-i-https)
6. [Logowanie](#logowanie)
7. [Przeniesienie danych z wersji w Claude](#przeniesienie-danych-z-wersji-w-claude)
8. [Kopie zapasowe](#kopie-zapasowe)
9. [Aktualizacja](#aktualizacja)
10. [Jak pracować przy szafie](#jak-pracować-przy-szafie)
11. [Struktura bazy i API](#struktura-bazy-i-api)
12. [Rozwiązywanie problemów](#rozwiązywanie-problemów)

---

## Co potrafi

- **Widok szafy** od góry do dołu z paskiem zajętości każdego urządzenia.
- **Front urządzenia.** Switche mają porty nieparzyste u góry i parzyste u dołu, plus porty SFP. Patchpanele mają moduły po 6 portów.
- **Statusy portów:** do ustalenia, zajęty, wolny, rezerwacja, uszkodzony. Dodatkowo znacznik „zweryfikowany fizycznie”.
- **Patchcordy zapisują się po obu stronach w jednej transakcji.** Przepięcie automatycznie zwalnia stary koniec.
- **Trasa kabla:** `PKN01:12 ⇄ B7 → Biuro 1.12, gniazdo 3 (Drukarka)`.
- **„Zapisz i dalej”** oraz strzałki ← → do szybkiego przechodzenia port po porcie.
- **Zaznaczanie wielu portów** i hurtowa zmiana statusu.
- **Wyszukiwarka** po pokoju, gnieździe, VLAN-ie, etykiecie i notatkach.
- **Historia zmian** każdego portu: kto i kiedy zmienił.
- **Eksport CSV** (otwiera się w Excelu) i **kopia JSON**, plus import JSON.
- Działa na telefonie. Karta portu wysuwa się wtedy od dołu.
- Automatyczne odświeżanie co 20 s, więc zmiany z telefonu widać na komputerze.

---

## Wymagania

- Ubuntu / Debian (inne Linuksy też, instalator zakłada `apt`-owe ścieżki tylko dla systemd).
- **Node.js 18 lub nowszy.** Sprawdź: `node -v`. Instalacja Node 22 LTS z NodeSource:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
  ```
- **MySQL 8** albo **MariaDB 10.5+**, już działający.
- `git`.

---

## Szybka instalacja

```bash
sudo mkdir -p /opt/rack-inventory && sudo chown "$USER": /opt/rack-inventory
git clone https://github.com/grubassound/inwent.git /opt/rack-inventory
cd /opt/rack-inventory
bash install.sh
```

> Repozytorium jest prywatne. Przy `git clone` przez HTTPS podaj login GitHub i **Personal Access Token** jako hasło (GitHub → Settings → Developer settings → Personal access tokens, uprawnienie `repo` lub fine-grained „Contents: Read”). Możesz też użyć klucza SSH: `git clone git@github.com:grubassound/inwent.git`.

Instalator po kolei:

1. Sprawdza wersję Node.js.
2. Instaluje zależności (`npm install --omit=dev`).
3. Pyta o dane bazy. Może też **sam założyć bazę i użytkownika MySQL** przez `sudo mysql`, z losowym hasłem zapisanym w `.env`.
4. Pyta o adres i port aplikacji oraz opcjonalny login i hasło.
5. Tworzy tabele i (jeśli chcesz) wczytuje układ racka: 16 urządzeń z inwentaryzacji.
6. Instaluje i uruchamia usługę systemd `rack-inventory`.

Po instalacji wejdź na `http://IP-SERWERA:3080`, jeśli wybrałeś `0.0.0.0`, albo skonfiguruj nginx (niżej).

---

## Instalacja ręczna

### 1. Baza i użytkownik MySQL

```bash
sudo mysql
```
```sql
CREATE DATABASE rack_inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'rack'@'localhost' IDENTIFIED BY 'TWOJE_MOCNE_HASLO';
GRANT ALL PRIVILEGES ON rack_inventory.* TO 'rack'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Jeśli MySQL stoi na innym serwerze, zamiast `'rack'@'localhost'` użyj `'rack'@'IP-serwera-aplikacji'` (albo `'%'`). Upewnij się też, że MySQL nasłuchuje na sieci (`bind-address` w `/etc/mysql/mysql.conf.d/mysqld.cnf`).

### 2. Kod i zależności

```bash
sudo mkdir -p /opt/rack-inventory && sudo chown "$USER": /opt/rack-inventory
git clone https://github.com/grubassound/inwent.git /opt/rack-inventory
cd /opt/rack-inventory
npm install --omit=dev
```

### 3. Konfiguracja

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

| Zmienna | Opis | Domyślnie |
|---|---|---|
| `HOST` | Adres nasłuchu. `127.0.0.1` za nginx, `0.0.0.0` dla całej sieci LAN | `127.0.0.1` |
| `PORT` | Port aplikacji | `3080` |
| `DB_HOST` / `DB_PORT` | Serwer MySQL | `localhost` / `3306` |
| `DB_NAME` | Nazwa bazy | `rack_inventory` |
| `DB_USER` / `DB_PASSWORD` | Użytkownik bazy | `rack` / – |
| `DB_SOCKET` | Opcjonalnie gniazdo unix, np. `/run/mysqld/mysqld.sock` | – |
| `AUTH_USER` / `AUTH_PASSWORD` | Logowanie do aplikacji. Puste = wyłączone | – |

### 4. Tabele i układ racka

```bash
npm run db:seed     # tworzy tabele i wczytuje 16 urządzeń (tylko gdy baza jest pusta)
# albo
npm run db:init     # same tabele; urządzenia dodasz w aplikacji
```

### 5. Test uruchomienia

```bash
npm start
# Rack Inventory działa na http://127.0.0.1:3080
curl http://127.0.0.1:3080/api/health   # {"ok":true}
```

Zatrzymaj przez `Ctrl+C`.

### 6. Usługa systemd

```bash
sudo cp deploy/rack-inventory.service /etc/systemd/system/
sudo nano /etc/systemd/system/rack-inventory.service   # popraw User, WorkingDirectory, ścieżkę do node (which node)
sudo systemctl daemon-reload
sudo systemctl enable --now rack-inventory
sudo systemctl status rack-inventory
```

Logi: `sudo journalctl -u rack-inventory -f`

---

## nginx i HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/rack-inventory
sudo nano /etc/nginx/sites-available/rack-inventory      # ustaw server_name
sudo ln -s /etc/nginx/sites-available/rack-inventory /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS przez Let's Encrypt (gdy serwer ma publiczną domenę):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d rack.twojadomena.pl
```

Aplikację można też wystawić pod podkatalogiem, np. `https://serwer/rack/`. Przykład jest w `deploy/nginx.conf`.

Apache zamiast nginx:

```apache
ProxyPass        / http://127.0.0.1:3080/
ProxyPassReverse / http://127.0.0.1:3080/
```

Wymaga włączenia modułów: `sudo a2enmod proxy proxy_http`.

---

## Logowanie

Ustaw w `.env`:

```
AUTH_USER=admin
AUTH_PASSWORD=mocne-haslo
```

Potem zrestartuj usługę: `sudo systemctl restart rack-inventory`. Przeglądarka zapyta o login i hasło (HTTP Basic). Jeśli aplikacja jest dostępna spoza LAN, używaj jej **tylko przez HTTPS**.

---

## Przeniesienie danych z wersji w Claude

Jeśli zacząłeś inwentaryzację w artefakcie w Claude:

1. W artefakcie kliknij **Kopia JSON** i zapisz plik.
2. W tej aplikacji kliknij **Import**, wybierz plik i potwierdź.

Format jest ten sam. Urządzenia o tych samych identyfikatorach zostaną nadpisane razem z portami i połączeniami.

---

## Kopie zapasowe

Ręcznie:

```bash
cd /opt/rack-inventory && bash backup.sh
```

Skrypt robi `mysqldump` do `backups/rack_DATA.sql.gz` i trzyma 30 ostatnich plików.

Automatycznie, codziennie o 2:15 (`crontab -e`):

```
15 2 * * * bash /opt/rack-inventory/backup.sh >/dev/null 2>&1
```

Przywracanie:

```bash
gunzip < backups/rack_2026-10-23_0215.sql.gz | mysql -u rack -p rack_inventory
```

Niezależnie od tego w aplikacji jest przycisk **Kopia JSON**, który zapisuje cały stan do pliku.

---

## Aktualizacja

```bash
cd /opt/rack-inventory
bash backup.sh
git pull
npm install --omit=dev
npm run db:init                     # bezpieczne: tworzy tylko brakujące tabele
sudo systemctl restart rack-inventory
```

---

## Jak pracować przy szafie

1. Otwórz aplikację na telefonie i wybierz urządzenie z listy szafy.
2. Kliknij port. Ustaw status, a w polu **Patchcord w racku** wybierz drugi koniec, np. switch PKN01 port 12. Drugi koniec uzupełni się sam.
3. Na patchpanelu wpisz **Dokąd prowadzi**, np. pokój i numer gniazda.
4. Wybierz kolor kabla, wpisz długość. Gdy kabel jest przetestowany, zaznacz **Zweryfikowany fizycznie**.
5. **Zapisz i dalej ›** przejdzie na kolejny port.
6. Puste gniazda oznaczaj hurtem: **Zaznacz wiele** → zaznacz porty → **Wolny**.
7. Pole **Plan po przebudowie** opisuje, gdzie port ma trafić po porządkowaniu racka.

Etykiety portów: patchpanele `A1…A24`, `B1…`, switche `PKN01:1…PKN01:52` (49–52 to SFP), `CAM-1…`.

---

## Struktura bazy i API

Tabele (`sql/schema.sql`):

- `devices`: urządzenia w szafie (typ, liczba portów RJ45 i SFP, stan, model, kolejność).
- `ports`: tylko porty, które zostały opisane. Połączenie to `link_device` + `link_port`, zawsze zapisywane po obu stronach.
- `port_history`: stan przed i po każdej zmianie portu, z autorem i czasem.

API (JSON):

| Metoda | Adres | Opis |
|---|---|---|
| GET | `/api/health` | Test połączenia z bazą |
| GET | `/api/state` | Cały stan: urządzenia z portami |
| POST | `/api/seed` | Wczytuje układ racka (tylko gdy pusto) |
| POST | `/api/devices` | Dodaje urządzenie |
| PUT | `/api/devices/:id` | Edytuje urządzenie |
| DELETE | `/api/devices/:id` | Usuwa urządzenie, rozłącza patchcordy do niego |
| POST | `/api/devices/reorder` | `{ids:[…]}` – nowa kolejność w szafie |
| PUT | `/api/ports/:dev/:n` | Zapis portu (z połączeniem po obu stronach) |
| POST | `/api/ports/bulk` | `{dev, ports:[…], status}` lub `{…, verified:true}` |
| GET | `/api/ports/:dev/:n/history` | 30 ostatnich zmian portu |
| GET | `/api/export.csv` | Eksport do Excela (średnik, UTF-8 z BOM) |
| GET | `/api/export.json` | Pełna kopia JSON |
| POST | `/api/import` | Import kopii JSON |

Przykład zapisu portu z terminala:

```bash
curl -X PUT http://127.0.0.1:3080/api/ports/pkn01/12 \
  -H 'Content-Type: application/json' \
  -d '{"status":"used","link":{"dev":"pp-b","port":"7"},"color":"czerwony","vlan":"10"}'
```

---

## Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|---|---|
| `Access denied for user 'rack'@'localhost'` | Hasło w `.env`. Czy użytkownik ma host `localhost`, a `DB_HOST=localhost`? Dla `127.0.0.1` MySQL może traktować to jako inny host. |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL nie działa albo nasłuchuje tylko na gnieździe. Ustaw `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| `Unknown collation utf8mb4_0900_ai_ci` | Starszy MariaDB. Schemat używa `utf8mb4_unicode_ci`, więc to dotyczy tylko ręcznie utworzonej bazy. Utwórz ją z `utf8mb4_unicode_ci`. |
| Strona nie otwiera się z innego komputera | `HOST=127.0.0.1` w `.env` (tylko lokalnie). Ustaw `0.0.0.0` albo nginx. Sprawdź `sudo ufw allow 3080/tcp`. |
| Usługa nie startuje | `sudo journalctl -u rack-inventory -n 50`. Najczęściej zła ścieżka do `node` albo brak praw do katalogu. |
| 413 przy imporcie przez nginx | Dodaj `client_max_body_size 10m;` (jest w `deploy/nginx.conf`). |
