# Serwer WWW na Linuksie od zera: Apache, PHP, MariaDB i dodatki

Instrukcja dla osoby, która ma serwer z Linuksem (fizyczny, wirtualny albo VPS) i chce na nim uruchamiać strony i aplikacje WWW: WordPressa, aplikację w PHP, stronę statyczną albo aplikację Node.js, taką jak Rack Inventory.

Polecenia są dla **Ubuntu 22.04 / 24.04** i **Debiana 12**. Na Rocky/Alma/RHEL różnice są w [ostatniej sekcji](#inne-dystrybucje-rocky--alma--rhel).

Wszystkie polecenia wykonujesz w terminalu na serwerze, jako zwykły użytkownik z prawem do `sudo`.

---

## Spis treści

1. [Co zainstalujemy i po co](#1-co-zainstalujemy-i-po-co)
2. [Przygotowanie systemu](#2-przygotowanie-systemu)
3. [Firewall](#3-firewall)
4. [Apache](#4-apache)
5. [PHP (PHP-FPM)](#5-php-php-fpm)
6. [MariaDB (MySQL)](#6-mariadb-mysql)
7. [Pierwsza strona: wirtualny host](#7-pierwsza-strona-wirtualny-host)
8. [HTTPS](#8-https)
9. [Dodatki: Composer, Node.js, phpMyAdmin](#9-dodatki-composer-nodejs-phpmyadmin)
10. [Przykłady wdrożeń](#10-przykłady-wdrożeń)
11. [Bezpieczeństwo](#11-bezpieczeństwo)
12. [Kopie zapasowe](#12-kopie-zapasowe)
13. [Gdzie co leży: ściągawka](#13-gdzie-co-leży-ściągawka)
14. [Rozwiązywanie problemów](#14-rozwiązywanie-problemów)
15. [Inne dystrybucje (Rocky / Alma / RHEL)](#inne-dystrybucje-rocky--alma--rhel)

---

## 1. Co zainstalujemy i po co

| Składnik | Do czego służy |
|---|---|
| **Apache 2.4** | Serwer WWW. Odbiera ruch z przeglądarek (porty 80 i 443), serwuje pliki i przekazuje zapytania do PHP albo do aplikacji (Node.js, Python…). |
| **PHP-FPM** | Wykonuje skrypty PHP. Działa jako osobna usługa, z którą Apache się komunikuje. To szybszy i bezpieczniejszy wariant niż stary `mod_php`. |
| **Rozszerzenia PHP** | Obsługa MySQL, obrazków, ZIP, XML, wielojęzyczności i innych. Wymaga ich większość aplikacji (WordPress, Laravel, Nextcloud…). |
| **MariaDB** | Baza danych zgodna z MySQL. Wszędzie, gdzie aplikacja wymaga „MySQL”, MariaDB zadziała. |
| **Certbot** | Darmowe certyfikaty HTTPS z Let's Encrypt, odnawiane automatycznie. |
| **Composer, Node.js** | Menedżery pakietów dla aplikacji PHP i JavaScript. Instaluj, gdy aplikacja ich wymaga. |
| **ufw, fail2ban, unattended-upgrades** | Firewall, blokowanie ataków na hasła i automatyczne poprawki bezpieczeństwa. |

Taki zestaw nazywa się potocznie **LAMP** (Linux, Apache, MySQL/MariaDB, PHP).

---

## 2. Przygotowanie systemu

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl wget git unzip zip nano ca-certificates gnupg lsb-release
```

Ustaw strefę czasową (ważne dla logów, zadań cron i dat w aplikacjach):

```bash
sudo timedatectl set-timezone Europe/Warsaw
timedatectl          # sprawdzenie
```

Sprawdź adres IP serwera, przyda się później:

```bash
hostname -I
```

> Jeśli po aktualizacji pojawi się komunikat o restarcie (`/var/run/reboot-required`), zrestartuj serwer: `sudo reboot`.

---

## 3. Firewall

Firewall przepuszcza tylko to, czego potrzebujesz: SSH (żeby się nie odciąć) i ruch WWW.

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH        # NAJPIERW SSH, inaczej stracisz połączenie z serwerem
sudo ufw enable
sudo ufw status
```

Reguły dla Apache dodasz po jego instalacji (krok 4).

> Na VPS-ie u dostawcy chmurowego (AWS, OVH, Hetzner…) często jest też firewall w panelu dostawcy. Otwórz w nim porty 80 i 443.

---

## 4. Apache

```bash
sudo apt install -y apache2
sudo ufw allow 'Apache Full'    # porty 80 i 443
sudo systemctl enable --now apache2
```

Sprawdzenie: wejdź w przeglądarce na `http://IP-SERWERA`. Powinna się pokazać strona „Apache2 Default Page / It works!”.

Włącz moduły, których potrzebuje większość stron i aplikacji:

```bash
sudo a2enmod rewrite headers ssl expires proxy proxy_http proxy_fcgi setenvif
sudo systemctl restart apache2
```

| Moduł | Do czego |
|---|---|
| `rewrite` | Ładne adresy (`.htaccess` w WordPressie, Laravelu i innych) |
| `headers` | Nagłówki bezpieczeństwa, przekazywanie informacji o HTTPS do aplikacji |
| `ssl` | HTTPS |
| `expires` | Cache plików statycznych w przeglądarce |
| `proxy`, `proxy_http` | Przekazywanie ruchu do aplikacji Node.js/Python (reverse proxy) |
| `proxy_fcgi`, `setenvif` | Połączenie Apache z PHP-FPM |

Podstawowe polecenia:

```bash
sudo apache2ctl configtest          # sprawdza konfigurację; zawsze przed przeładowaniem
sudo systemctl reload apache2       # wczytuje zmiany bez przerywania połączeń
sudo systemctl restart apache2      # pełny restart (np. po włączeniu modułu)
sudo a2ensite nazwa / a2dissite nazwa   # włącza / wyłącza stronę z sites-available
sudo a2enmod nazwa  / a2dismod nazwa    # włącza / wyłącza moduł
```

---

## 5. PHP (PHP-FPM)

```bash
sudo apt install -y php-fpm php-cli php-mysql php-curl php-gd php-mbstring php-xml \
  php-zip php-intl php-bcmath php-imagick
```

Te pakiety zawsze instalują wersję PHP domyślną dla systemu: 8.1 na Ubuntu 22.04, 8.3 na Ubuntu 24.04, 8.2 na Debianie 12. Połącz PHP-FPM z Apache:

```bash
PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
echo "Wersja PHP: $PHPV"
sudo a2enconf php${PHPV}-fpm
sudo systemctl enable --now php${PHPV}-fpm
sudo systemctl reload apache2
```

Co dają rozszerzenia:

| Pakiet | Do czego |
|---|---|
| `php-mysql` | Połączenie z MariaDB/MySQL (`mysqli`, `PDO`) |
| `php-curl` | Zapytania do innych serwerów (API, aktualizacje wtyczek) |
| `php-gd`, `php-imagick` | Obrazki: miniatury, zmiana rozmiaru |
| `php-mbstring`, `php-intl` | Polskie znaki i inne języki, formatowanie dat i liczb |
| `php-xml` | XML, RSS, wiele bibliotek |
| `php-zip` | Archiwa ZIP (instalacja wtyczek, eksporty) |
| `php-bcmath` | Dokładne obliczenia (sklepy, faktury) |

Sprawdzenie, co jest zainstalowane: `php -v` i `php -m`. OPcache, który przyspiesza PHP, instaluje się razem z PHP. Sprawdzisz go poleceniem `php -m | grep -i opcache`.

### Ustawienia PHP

Typowe zmiany w `/etc/php/WERSJA/fpm/php.ini` (np. `/etc/php/8.3/fpm/php.ini`):

```ini
memory_limit = 256M
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 120
date.timezone = Europe/Warsaw
expose_php = Off
```

Po zmianie: `sudo systemctl restart php${PHPV}-fpm`.

### Test PHP

```bash
echo '<?php phpinfo();' | sudo tee /var/www/html/info.php
```

Wejdź na `http://IP-SERWERA/info.php`. W tabeli „Server API” powinno być **FPM/FastCGI**. **Potem usuń ten plik**, bo pokazuje szczegóły serwera:

```bash
sudo rm /var/www/html/info.php
```

---

## 6. MariaDB (MySQL)

```bash
sudo apt install -y mariadb-server
sudo systemctl enable --now mariadb
sudo mariadb-secure-installation
```

Odpowiedzi w `mariadb-secure-installation`:

| Pytanie | Odpowiedź |
|---|---|
| Enter current password for root | Enter (hasła jeszcze nie ma) |
| Switch to unix_socket authentication | `n` (już jest włączone) |
| Change the root password | `n`. Root loguje się przez `sudo mariadb` bez hasła i tak jest najbezpieczniej. |
| Remove anonymous users | `Y` |
| Disallow root login remotely | `Y` |
| Remove test database | `Y` |
| Reload privilege tables | `Y` |

> Na starszych systemach polecenie nazywa się `mysql_secure_installation`.

### Baza i użytkownik dla każdej aplikacji

Każda aplikacja powinna mieć własną bazę i własnego użytkownika z dostępem tylko do niej:

```bash
sudo mariadb
```

```sql
CREATE DATABASE mojaapka CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mojaapka'@'localhost' IDENTIFIED BY 'MOCNE_HASLO';
GRANT ALL PRIVILEGES ON mojaapka.* TO 'mojaapka'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Mocne hasło wygenerujesz poleceniem `openssl rand -base64 24`.

W aplikacji wpisujesz: host `localhost`, baza `mojaapka`, użytkownik `mojaapka` i to hasło.

> Baza domyślnie nasłuchuje tylko lokalnie (`127.0.0.1`) i tak powinno zostać. Dostęp z innego komputera ustaw tylko wtedy, gdy naprawdę jest potrzebny, i ogranicz go firewallem do konkretnego IP.

---

## 7. Pierwsza strona: wirtualny host

Apache może obsługiwać wiele stron naraz. Każda ma własny plik konfiguracyjny (**vhost**) i własny katalog.

### Katalog strony

```bash
sudo mkdir -p /var/www/mojastrona/public
sudo chown -R $USER:www-data /var/www/mojastrona
sudo chmod 2750 /var/www/mojastrona /var/www/mojastrona/public
echo '<h1>Działa!</h1>' > /var/www/mojastrona/public/index.html
```

Uprawnienia: Ty jesteś właścicielem plików i możesz je edytować, a Apache/PHP (grupa `www-data`) może je tylko czytać. Bit `2` (setgid) sprawia, że nowe pliki też dostają grupę `www-data`. Katalogi, do których aplikacja musi zapisywać (uploady, cache), otwórz osobno:

```bash
mkdir -p /var/www/mojastrona/public/uploads
chmod 2770 /var/www/mojastrona/public/uploads
```

Gdy wgrasz gotową aplikację z wieloma plikami, popraw uprawnienia hurtowo: katalogi 2750, pliki 640.

```bash
find /var/www/mojastrona -type d -exec chmod 2750 {} +
find /var/www/mojastrona -type f -exec chmod 640 {} +
```

### Konfiguracja vhosta

```bash
sudo nano /etc/apache2/sites-available/mojastrona.conf
```

```apache
<VirtualHost *:80>
    ServerName mojastrona.pl
    ServerAlias www.mojastrona.pl
    DocumentRoot /var/www/mojastrona/public

    <Directory /var/www/mojastrona/public>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog  ${APACHE_LOG_DIR}/mojastrona-error.log
    CustomLog ${APACHE_LOG_DIR}/mojastrona-access.log combined
</VirtualHost>
```

- `ServerName` to adres, pod którym strona ma działać. Domena musi w DNS wskazywać na IP serwera (rekord A). W sieci lokalnej bez DNS możesz dopisać `IP-SERWERA mojastrona.lan` do pliku `hosts` na komputerze (Windows: `C:\Windows\System32\drivers\etc\hosts`).
- `Options -Indexes` wyłącza listowanie plików w katalogach.
- `AllowOverride All` pozwala na pliki `.htaccess`, których używa większość aplikacji PHP.

Włączenie:

```bash
sudo a2ensite mojastrona
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Domyślną stronę Apache wyłączysz poleceniem `sudo a2dissite 000-default && sudo systemctl reload apache2`. Zostaw ją, jeśli wchodzisz na serwer po samym IP.

---

## 8. HTTPS

### Publiczna domena: Let's Encrypt (darmowe, automatyczne)

Wymagania: domena wskazuje na serwer, a porty 80 i 443 są otwarte z internetu.

```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d mojastrona.pl -d www.mojastrona.pl
```

Certbot sam doda konfigurację HTTPS i przekierowanie z HTTP. Certyfikat odnawia się automatycznie. Odnowienie sprawdzisz poleceniem `sudo certbot renew --dry-run`.

### Tylko sieć lokalna: certyfikat self-signed

Let's Encrypt nie wystawi certyfikatu dla adresu z LAN. Najprościej użyć gotowego certyfikatu testowego Debiana/Ubuntu:

```bash
sudo apt install -y ssl-cert
sudo a2enmod ssl
sudo a2ensite default-ssl
sudo systemctl reload apache2
```

Od teraz działa `https://IP-SERWERA`. Przeglądarka pokaże ostrzeżenie, które akceptujesz raz na każdym komputerze. Dla własnego vhosta skopiuj blok `<VirtualHost *:443>` z `/etc/apache2/sites-available/default-ssl.conf` i zmień w nim `ServerName` oraz `DocumentRoot`.

---

## 9. Dodatki: Composer, Node.js, phpMyAdmin

### Composer (aplikacje PHP: Laravel, Symfony…)

```bash
sudo apt install -y composer
composer --version
```

### Node.js (aplikacje JavaScript, np. Rack Inventory)

Wersja z repozytorium systemu bywa stara, więc lepiej instalować z NodeSource (wersja LTS):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

Aplikacja Node.js działa jako osobna usługa (systemd) na porcie lokalnym, a Apache przekazuje do niej ruch. Przykład jest w [sekcji 10](#aplikacja-nodejs-za-apache).

### phpMyAdmin (opcjonalnie: zarządzanie bazą przez przeglądarkę)

```bash
sudo apt install -y phpmyadmin
```

- Instalator zapyta o serwer WWW. Zaznacz **apache2** spacją, potem Enter.
- Na pytanie „Configure database with dbconfig-common” odpowiedz **Tak** i ustaw hasło.

phpMyAdmin działa pod `http://IP-SERWERA/phpmyadmin`. Logujesz się użytkownikiem konkretnej bazy, np. `mojaapka`. Root przez phpMyAdmin nie zadziała, bo loguje się tylko przez `sudo`.

**Ogranicz dostęp do sieci lokalnej.** phpMyAdmin to częsty cel ataków. Dopisz w `/etc/phpmyadmin/apache.conf`, w sekcji `<Directory /usr/share/phpmyadmin>`:

```apache
Require ip 127.0.0.1 192.168.0.0/16 10.0.0.0/8
```

Potem `sudo systemctl reload apache2`. Jeśli phpMyAdmin nie jest potrzebny na co dzień, wyłącz go: `sudo a2disconf phpmyadmin && sudo systemctl reload apache2`.

---

## 10. Przykłady wdrożeń

### Strona statyczna (HTML/CSS/JS)

Wgraj pliki do `/var/www/mojastrona/public` (np. przez `scp`, `rsync`, `git clone` albo WinSCP/FileZilla w trybie SFTP). Nic więcej nie trzeba.

### Aplikacja PHP, np. WordPress

```bash
# baza i użytkownik jak w kroku 6 (np. wordpress / wordpress)
cd /tmp && wget https://pl.wordpress.org/latest-pl_PL.tar.gz
tar xzf latest-pl_PL.tar.gz
sudo mkdir -p /var/www/wordpress/public
sudo cp -r wordpress/. /var/www/wordpress/public/
sudo chown -R www-data:www-data /var/www/wordpress/public
```

WordPress sam aktualizuje pliki i wtyczki, więc tu właścicielem jest `www-data`. Vhost jak w kroku 7, z `DocumentRoot /var/www/wordpress/public`. Potem wejdź na adres strony i przejdź kreator.

### Aplikacja PHP z frameworkiem (Laravel i podobne)

Kod w `/var/www/app`, a `DocumentRoot` wskazuje na **podkatalog `public`**, nigdy na cały katalog aplikacji (inaczej pliki `.env` z hasłami byłyby dostępne z sieci):

```bash
cd /var/www/app
composer install --no-dev --optimize-autoloader
# katalogi, do których aplikacja zapisuje (logi, cache, sesje)
sudo chgrp -R www-data storage bootstrap/cache
chmod -R g+rwX storage bootstrap/cache
```

### Aplikacja Node.js za Apache

Aplikacja działa jako usługa na porcie lokalnym, np. 3000, a Apache przekazuje do niej ruch (reverse proxy). Vhost:

```apache
<VirtualHost *:80>
    ServerName app.mojastrona.pl
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    RequestHeader set X-Forwarded-Proto "http"
</VirtualHost>
```

Dla **Rack Inventory** jest gotowa konfiguracja w [`deploy/apache.conf`](../deploy/apache.conf), a instalacja jest opisana w [README](../README.md#apache-nginx-i-https).

### Kilka stron na jednym serwerze

Każda strona ma własny plik w `/etc/apache2/sites-available/` z innym `ServerName` i własnym `DocumentRoot` albo `ProxyPass`. Apache wybiera stronę po adresie wpisanym w przeglądarce. Na jednym serwerze mogą działać naraz np. WordPress, aplikacja Laravel i aplikacja Node.js.

---

## 11. Bezpieczeństwo

**Ukryj wersje oprogramowania** w `/etc/apache2/conf-available/security.conf`:

```apache
ServerTokens Prod
ServerSignature Off
```

Potem `sudo systemctl reload apache2`. W PHP: `expose_php = Off` (krok 5).

**Automatyczne poprawki bezpieczeństwa:**

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # wybierz „Tak”
```

**fail2ban**, czyli blokowanie adresów, które zgadują hasła (SSH, Apache):

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

**SSH:** logowanie kluczem zamiast hasła. Na swoim komputerze: `ssh-keygen`, potem `ssh-copy-id uzytkownik@IP-SERWERA`. Gdy logowanie kluczem działa, możesz wyłączyć hasła w `/etc/ssh/sshd_config` (`PasswordAuthentication no`) i wykonać `sudo systemctl restart ssh`. **Najpierw sprawdź klucz w drugim oknie terminala**, żeby się nie odciąć.

**Zasady ogólne:**
- Każda aplikacja ma własnego użytkownika bazy z dostępem tylko do swojej bazy.
- Pliki z hasłami (`.env`, `wp-config.php`) nie mogą leżeć w `DocumentRoot` ani być czytelne dla wszystkich (`chmod 640` lub `600`).
- Panele administracyjne (phpMyAdmin, `/wp-admin`) ogranicz do sieci lokalnej albo zabezpiecz dodatkowym hasłem.
- Aktualizuj system, PHP i same aplikacje (wtyczki WordPressa!).

---

## 12. Kopie zapasowe

Trzy rzeczy do kopiowania: **bazy danych**, **pliki stron** i **konfiguracja**. Przykładowy skrypt `/usr/local/bin/kopia-www.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
DIR=/var/backups/www/$(date +%F)
mkdir -p "$DIR"
# wszystkie bazy (root łączy się przez gniazdo, bez hasła)
mariadb-dump --all-databases --single-transaction --routines --events | gzip > "$DIR/bazy.sql.gz"
# pliki stron i konfiguracja
tar czf "$DIR/www.tar.gz" -C / var/www
tar czf "$DIR/konfiguracja.tar.gz" -C / etc/apache2 etc/php etc/mysql etc/letsencrypt 2>/dev/null || true
# trzymaj 14 dni
find /var/backups/www -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

```bash
sudo chmod 700 /usr/local/bin/kopia-www.sh
sudo crontab -e
# dopisz: codziennie o 3:00
0 3 * * * /usr/local/bin/kopia-www.sh
```

> Kopia na tym samym dysku nie ochroni przed awarią dysku ani włamaniem. Kopiuj `/var/backups/www` także na inny komputer albo NAS (np. `rsync` przez SSH) i co jakiś czas sprawdź, czy da się z niej coś odtworzyć.

Odtworzenie bazy: `gunzip < bazy.sql.gz | sudo mariadb`.

---

## 13. Gdzie co leży: ściągawka

| Co | Gdzie |
|---|---|
| Pliki stron | `/var/www/` |
| Konfiguracje stron (vhosty) | `/etc/apache2/sites-available/` (włączone: `sites-enabled/`) |
| Główna konfiguracja Apache | `/etc/apache2/apache2.conf` |
| Logi Apache | `/var/log/apache2/` (`error.log`, `access.log` i logi poszczególnych stron) |
| Konfiguracja PHP-FPM | `/etc/php/WERSJA/fpm/php.ini`, pule: `/etc/php/WERSJA/fpm/pool.d/` |
| Logi PHP-FPM | `/var/log/phpWERSJA-fpm.log` |
| Konfiguracja MariaDB | `/etc/mysql/mariadb.conf.d/50-server.cnf` |
| Logi MariaDB | `sudo journalctl -u mariadb` |
| Certyfikaty Let's Encrypt | `/etc/letsencrypt/live/DOMENA/` |

Najczęstsze polecenia:

```bash
sudo systemctl status apache2 php8.3-fpm mariadb    # stan usług (popraw wersję PHP)
sudo tail -f /var/log/apache2/error.log             # błędy na żywo
sudo apache2ctl -S                                  # lista stron i adresów
sudo ss -tlnp                                       # kto nasłuchuje na jakich portach
```

---

## 14. Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|---|---|
| Strona w ogóle się nie otwiera | `sudo systemctl status apache2`, `sudo ufw status` (czy jest „Apache Full”), firewall u dostawcy VPS. |
| Widać stronę „Apache2 Default Page” zamiast mojej | Wpisany adres nie zgadza się z `ServerName`/`ServerAlias` albo strona nie jest włączona (`a2ensite`). Sprawdź `sudo apache2ctl -S`. |
| Przeglądarka pobiera plik `.php` zamiast go wykonać | PHP-FPM niepodłączony: `sudo a2enconf phpWERSJA-fpm && sudo systemctl reload apache2`, sprawdź `systemctl status phpWERSJA-fpm`. |
| **403 Forbidden** | Brak `Require all granted` w `<Directory>`, złe uprawnienia (Apache musi móc wejść do każdego katalogu na ścieżce) albo brak `index.php`/`index.html` przy `-Indexes`. |
| **404** na podstronach (WordPress, Laravel) | Brak `mod_rewrite` (`sudo a2enmod rewrite`) albo `AllowOverride None` zamiast `All`. |
| **500 Internal Server Error** | Szczegóły są w logu błędów strony w `/var/log/apache2/`. Często literówka w `.htaccess` albo błąd PHP. |
| **502/503** przy aplikacji Node.js | Aplikacja nie działa albo działa na innym porcie niż w `ProxyPass`: `systemctl status NAZWA-USŁUGI`, `ss -tlnp`. |
| `Invalid command 'ProxyPass'` / `'RewriteEngine'` / `'RequestHeader'` | Brak modułu: `sudo a2enmod proxy proxy_http rewrite headers`. |
| „Error establishing a database connection” / `Access denied` | Błędna nazwa bazy, użytkownika albo hasła w konfiguracji aplikacji. Test: `mariadb -u mojaapka -p mojaapka`. |
| Nie da się wgrać dużego pliku | `upload_max_filesize` i `post_max_size` w `php.ini`, potem restart PHP-FPM. |
| Certbot: „Timeout during connect” | Domena nie wskazuje na serwer albo port 80 jest zamknięty z internetu. |
| Ostrzeżenie `AH00558: Could not reliably determine the server's fully qualified domain name` | Niegroźne. Żeby zniknęło: `echo "ServerName localhost" \| sudo tee /etc/apache2/conf-available/servername.conf && sudo a2enconf servername && sudo systemctl reload apache2`. |
| `Address already in use` przy starcie Apache | Port 80 jest zajęty przez inny serwer (np. nginx): `sudo ss -tlnp | grep ':80'`. |

---

## Inne dystrybucje (Rocky / Alma / RHEL)

Zasady są te same, różnią się nazwy pakietów i ścieżki:

| | Ubuntu / Debian | Rocky / Alma / RHEL |
|---|---|---|
| Instalacja pakietów | `apt install` | `dnf install` |
| Apache | `apache2`, usługa `apache2` | `httpd`, usługa `httpd` |
| Konfiguracje stron | `/etc/apache2/sites-available/` + `a2ensite` | pliki `*.conf` w `/etc/httpd/conf.d/` (bez a2ensite) |
| Moduły | `a2enmod nazwa` | zwykle włączone; lista w `/etc/httpd/conf.modules.d/` |
| Użytkownik Apache | `www-data` | `apache` |
| PHP | `php-fpm` + `a2enconf` | `dnf install php php-fpm php-mysqlnd php-gd php-mbstring php-xml php-intl php-zip`, potem `systemctl enable --now php-fpm`; Apache podłącza się sam |
| Baza | `mariadb-server` | `mariadb-server` |
| Firewall | `ufw` | `firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload` |
| Logi | `/var/log/apache2/` | `/var/log/httpd/` |

Na RHEL i pochodnych działa też **SELinux**. Żeby Apache mógł łączyć się z aplikacją Node.js (reverse proxy), wykonaj: `sudo setsebool -P httpd_can_network_connect 1`.
