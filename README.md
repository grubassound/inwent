# Rack Inventory

Aplikacja webowa do inwentaryzacji szafy sieciowej. Opisujesz w niej każdy port patchpaneli i switchy: status, patchcord w racku (oba końce), dokąd prowadzi kabel, urządzenie końcowe, VLAN, kolor i długość kabla, etykietę, plan po przebudowie i notatki. Dane trzymane są w MySQL/MariaDB, a każda zmiana portu trafia do historii.

Stack: **Node.js 18+ · Express · MySQL 8 / MariaDB 10.5+**. Frontend to czysty HTML/CSS/JS bez kompilacji.

Jak to działa na serwerze: aplikacja to mały serwer Node.js, który działa w tle jako usługa systemd i nasłuchuje tylko lokalnie (`127.0.0.1:3080`). Z sieci łączysz się przez **Apache** (albo nginx). Apache odbiera ruch na portach 80/443, obsługuje HTTPS i przekazuje zapytania do Node.js. Ten sam Apache może jednocześnie obsługiwać inne strony, np. w PHP.

```
przeglądarka ──► Apache :80/:443 ──► Node.js 127.0.0.1:3080 ──► MySQL/MariaDB
                    └──► inne strony (PHP, statyczne…)
```

> Nie masz jeszcze serwera WWW? Instrukcja instalacji Apache, PHP, MariaDB, HTTPS i dodatków od zera na Ubuntu/Debian jest w **[docs/serwer-www-linux.md](docs/serwer-www-linux.md)**.

---

## Spis treści

1. [Co potrafi](#co-potrafi)
2. [Wymagania](#wymagania)
3. [Szybka instalacja (install.sh)](#szybka-instalacja)
4. [Instalacja ręczna krok po kroku](#instalacja-ręczna)
5. [Apache, nginx i HTTPS](#apache-nginx-i-https)
6. [Logowanie](#logowanie)
7. [Przeniesienie danych z wersji w Claude](#przeniesienie-danych-z-wersji-w-claude)
8. [Kopie zapasowe](#kopie-zapasowe)
9. [Aktualizacja](#aktualizacja)
10. [Jak pracować przy szafie](#jak-pracować-przy-szafie)
11. [Struktura bazy i API](#struktura-bazy-i-api)
12. [Testy](#testy)
13. [Rozwiązywanie problemów](#rozwiązywanie-problemów)

---

## Co potrafi

- **Widok szafy** od góry do dołu z paskiem zajętości każdego urządzenia.
- **Front urządzenia.** Switche mają porty nieparzyste u góry i parzyste u dołu, plus porty SFP. Patchpanele mają moduły po 6 portów.
- **Statusy portów:** do ustalenia, zajęty, wolny, rezerwacja, uszkodzony. Dodatkowo znacznik „zweryfikowany fizycznie”.
- **Patchcordy zapisują się po obu stronach w jednej transakcji.** Przepięcie automatycznie zwalnia stary koniec: port „Zajęty” wraca wtedy do „Do ustalenia”. Kolor, długość i etykieta kabla są wspólne dla obu końców.
- **Trasa kabla:** `PKN01:12 ⇄ B7 → Biuro 1.12, gniazdo 3 (Drukarka)`.
- **„Zapisz i dalej”** oraz strzałki ← → do szybkiego przechodzenia port po porcie.
- **Zaznaczanie wielu portów** i hurtowa zmiana statusu. Hurtowe „Wolny” odpina patchcordy z zaznaczonych portów.
- **Ochrona przed nadpisaniem:** gdy dwie osoby edytują ten sam port, druga dostaje ostrzeżenie z aktualnym stanem z bazy i sama decyduje, czy nadpisać. Przy przejściu do innego portu aplikacja pyta o niezapisane zmiany.
- **Zmniejszenie liczby portów urządzenia** usuwa opis portów spoza nowego zakresu i odpina prowadzące do nich patchcordy. Aplikacja najpierw pyta o zgodę.
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
- **Apache 2.4** (albo nginx) jako serwer WWW przed aplikacją. Bez niego aplikacja też działa, ale tylko pod adresem `http://IP:3080` i bez HTTPS.
- `git`.

Brakuje czegoś z tej listy? Wszystko po kolei: [docs/serwer-www-linux.md](docs/serwer-www-linux.md).

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

Na pytanie o adres nasłuchu zostaw `127.0.0.1`, jeśli aplikacja ma działać za Apache. Potem skonfiguruj Apache według sekcji [Apache, nginx i HTTPS](#apache-nginx-i-https). Adres `0.0.0.0` wybierz tylko wtedy, gdy nie używasz serwera WWW i chcesz wchodzić bezpośrednio na `http://IP-SERWERA:3080`.

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
| `HOST` | Adres nasłuchu. `127.0.0.1` za Apache/nginx, `0.0.0.0` dla całej sieci LAN bez serwera WWW | `127.0.0.1` |
| `PORT` | Port aplikacji | `3080` |
| `DB_HOST` / `DB_PORT` | Serwer MySQL | `localhost` / `3306` |
| `DB_NAME` | Nazwa bazy | `rack_inventory` |
| `DB_USER` / `DB_PASSWORD` | Użytkownik bazy | `rack` / – |
| `DB_SOCKET` | Opcjonalnie gniazdo unix, np. `/run/mysqld/mysqld.sock` | – |
| `AUTH_USER` / `AUTH_PASSWORD` | Logowanie do aplikacji. Puste = wyłączone. Hasło ze znakami `#`, `$`, `` ` `` lub spacją wpisz w apostrofach | – |
| `HISTORY_DAYS` | Ile dni trzymać historię zmian portów. `0` = bez limitu | `0` |

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

## Apache, nginx i HTTPS

Najpierw upewnij się, że aplikacja działa lokalnie: `curl http://127.0.0.1:3080/api/health` powinno zwrócić `{"ok":true}`. W `.env` ustaw `HOST=127.0.0.1`, żeby port 3080 nie był dostępny z sieci z pominięciem Apache.

### Apache

Gotowa konfiguracja z komentarzami jest w [`deploy/apache.conf`](deploy/apache.conf). Na początek włącz moduły proxy (jednorazowo):

```bash
sudo a2enmod proxy proxy_http headers
sudo systemctl restart apache2
```

Potem wybierz jeden z dwóch wariantów.

**Wariant A: osobny adres**, np. `http://rack.firma.lan` albo `https://rack.twojadomena.pl`. Wymaga wpisu DNS (albo wpisu w `hosts` na komputerach w LAN) wskazującego na serwer.

```bash
sudo cp deploy/apache.conf /etc/apache2/sites-available/rack-inventory.conf
sudo nano /etc/apache2/sites-available/rack-inventory.conf   # ustaw ServerName
sudo a2ensite rack-inventory
sudo apache2ctl configtest            # ma wypisać: Syntax OK
sudo systemctl reload apache2
```

**Wariant B: podkatalog strony, która już działa**, np. `http://serwer/rack/`. Bez DNS, a reszta strony (np. PHP) działa jak dotąd. Dopisz do istniejącego `<VirtualHost>` (zwykle `/etc/apache2/sites-available/000-default.conf`, a przy HTTPS także `default-ssl.conf`) przed `</VirtualHost>`:

```apache
RedirectMatch 301 ^/rack$ /rack/
<Location /rack/>
    ProxyPass        http://127.0.0.1:3080/ timeout=60
    ProxyPassReverse http://127.0.0.1:3080/
    LimitRequestBody 10485760
</Location>
```

Potem `sudo apache2ctl configtest && sudo systemctl reload apache2`. Ukośnik na końcu `/rack/` jest ważny: frontend używa ścieżek względnych, dlatego `/rack` jest przekierowywane na `/rack/`.

**HTTPS:**

- Z publiczną domeną (Let's Encrypt, certyfikat odnawia się sam):
  ```bash
  sudo apt install -y certbot python3-certbot-apache
  sudo certbot --apache -d rack.twojadomena.pl
  ```
- Tylko w LAN, bez domeny: certyfikat self-signed. Instrukcja jest w komentarzach w `deploy/apache.conf`. Przeglądarka raz zapyta o wyjątek bezpieczeństwa.

Logi Apache dla aplikacji: `/var/log/apache2/rack-inventory-error.log` i `rack-inventory-access.log` (wariant A) albo logi strony głównej (wariant B).

### nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/rack-inventory
sudo nano /etc/nginx/sites-available/rack-inventory      # ustaw server_name
sudo ln -s /etc/nginx/sites-available/rack-inventory /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS: `sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d rack.twojadomena.pl`. Wariant z podkatalogiem jest w `deploy/nginx.conf`.

> Apache i nginx nie mogą jednocześnie nasłuchiwać na porcie 80. Na jednym serwerze używaj jednego z nich.

---

## Logowanie

Ustaw w `.env`:

```
AUTH_USER=admin
AUTH_PASSWORD=mocne-haslo
```

Potem zrestartuj usługę: `sudo systemctl restart rack-inventory`. Przeglądarka zapyta o login i hasło (HTTP Basic). Po 10 nieudanych próbach z jednego adresu logowanie jest blokowane na 15 minut. Jeśli aplikacja jest dostępna spoza LAN, używaj jej **tylko przez HTTPS**.

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

Skrypt robi `mysqldump` do `backups/rack_DATA.sql.gz` i trzyma 30 ostatnich plików. Pliki kopii czyta tylko właściciel (uprawnienia 600), bo zawierają całą bazę.

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
| PUT | `/api/ports/:dev/:n` | Zapis portu (z połączeniem po obu stronach). Opcjonalne `baseRev` (pole `rev` z `/api/state`): jeśli port zmienił się w międzyczasie, odpowiedź to 409 |
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

## Testy

Testy API (`test/api.test.js`) działają na prawdziwej bazie MySQL/MariaDB. **Czyszczą wszystkie tabele**, więc użyj osobnej bazy, której nazwa zawiera „test”:

```bash
sudo mysql -e "CREATE DATABASE rack_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON rack_test.* TO 'rack'@'localhost';"
TEST_DB_NAME=rack_test TEST_DB_USER=rack TEST_DB_PASSWORD='hasło' npm test
```

Bez `TEST_DB_NAME` testy są pomijane. Opcjonalnie: `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_PORT` (port serwera testowego, domyślnie 39080).

---

## Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|---|---|
| `Access denied for user 'rack'@'localhost'` | Hasło w `.env`. Czy użytkownik ma host `localhost`, a `DB_HOST=localhost`? Dla `127.0.0.1` MySQL może traktować to jako inny host. |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL nie działa albo nasłuchuje tylko na gnieździe. Ustaw `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| `Unknown collation utf8mb4_0900_ai_ci` | Starszy MariaDB. Schemat używa `utf8mb4_unicode_ci`, więc to dotyczy tylko ręcznie utworzonej bazy. Utwórz ją z `utf8mb4_unicode_ci`. |
| Strona nie otwiera się z innego komputera | Za Apache: czy firewall przepuszcza HTTP/HTTPS (`sudo ufw allow 'Apache Full'`)? Bez Apache: `HOST=127.0.0.1` w `.env` oznacza tylko lokalnie. Ustaw `0.0.0.0` i `sudo ufw allow 3080/tcp`. |
| Usługa nie startuje | `sudo journalctl -u rack-inventory -n 50`. Najczęściej zła ścieżka do `node` albo brak praw do katalogu. |
| Apache: **503 Service Unavailable** | Node.js nie działa: `sudo systemctl status rack-inventory`. Sprawdź też, czy port w `ProxyPass` zgadza się z `PORT` w `.env`. |
| Apache: `Invalid command 'ProxyPass'` albo `'RequestHeader'` przy `configtest` | Nie włączono modułów: `sudo a2enmod proxy proxy_http headers`. |
| Apache: strona startowa Apache („It works!”) zamiast aplikacji | Wariant A: wpisany adres nie zgadza się z `ServerName`/`ServerAlias`, więc Apache użył domyślnej strony. Wariant B: brakuje ukośnika, wejdź na `/rack/`. |
| Pod `/rack/` strona bez stylów, błędy 404 w konsoli | Adres bez końcowego ukośnika. Dodaj `RedirectMatch 301 ^/rack$ /rack/`. |
| 413 przy imporcie | Apache: `LimitRequestBody 10485760`. nginx: `client_max_body_size 10m;`. Obie wartości są w plikach w `deploy/`. |
