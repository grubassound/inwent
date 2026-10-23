// Języki (pl, en, nl, cs) i motyw (jasny/ciemny). Ładowany w <head> obu stron, przed stylami,
// żeby od razu ustawić motyw i język bez mignięcia.
(() => {
'use strict';
const LANGS = { pl: 'Polski', en: 'English', nl: 'Nederlands', cs: 'Čeština' };

const D = {
pl: {
  'zoom.in': 'Przybliż', 'zoom.out': 'Oddal', 'zoom.fit': 'Dopasuj', 'zoom.hint': 'Kliknij gniazdo, żeby edytować port. Ctrl + kółko myszy (albo gest szczypania) przybliża i oddala.',
  'f.preset': 'Szablon modelu (Aruba)', 'preset.custom': '— własny / inny —',
  'app.title': 'Inwentaryzacja racka',
  'mode.connecting': 'Łączenie z serwerem…', 'mode.online': 'Dane w bazie MySQL · odświeżanie co 20 s', 'mode.offline': 'Brak połączenia z serwerem',
  'stats.ports': 'Porty', 'stats.verified': 'Zweryfikowane',
  'banner.offline': 'Serwer nie odpowiada. Zmiany nie zostaną zapisane, dopóki połączenie nie wróci.',
  'banner.expired': 'Sesja wygasła. Zaloguj się ponownie, a potem wróć tutaj i zapisz port.', 'banner.expiredLink': 'Otwórz logowanie w nowej karcie',
  'search.ph': 'Szukaj: pokój, gniazdo, VLAN, B12…', 'search.label': 'Szukaj',
  'btn.json': 'Kopia JSON', 'btn.import': 'Import', 'btn.logout': 'Wyloguj',
  'theme.toDark': 'Włącz ciemny motyw', 'theme.toLight': 'Włącz jasny motyw', 'lang.label': 'Język',
  'status.unknown': 'Do ustalenia', 'status.used': 'Zajęty', 'status.free': 'Wolny', 'status.reserved': 'Rezerwacja', 'status.broken': 'Uszkodzony',
  'kind.patch': 'Patchpanel', 'kind.switch': 'Switch', 'kind.fiber': 'Panel światłowodowy', 'kind.other': 'Inne',
  'devstatus.active': 'W użyciu', 'devstatus.unused': 'Nieużywany', 'devstatus.remove': 'Do demontażu',
  'color.czarny': 'czarny', 'color.czerwony': 'czerwony', 'color.niebieski': 'niebieski', 'color.zielony': 'zielony', 'color.pomarańczowy': 'pomarańczowy',
  'color.biały': 'biały', 'color.żółty': 'żółty', 'color.szary': 'szary', 'color.różowy': 'różowy', 'color.turkusowy (światłowód)': 'turkusowy (światłowód)', 'color.none': 'brak',
  'rack.label': 'Rack', 'rack.aria': 'Urządzenia w racku', 'rack.select': 'Wybierz rack', 'rack.edit': 'Edytuj rack', 'rack.add': 'Dodaj rack',
  'rack.top': 'Szafa · od góry', 'rack.noDevices': 'Brak urządzeń', 'rack.this': 'Ten rack',
  'rack.formNew': 'Nowy rack', 'rack.formEdit': 'Edycja racka', 'rack.delOnlyEmpty': 'Usunąć można tylko pusty rack', 'rack.delete': 'Usuń rack',
  'rack.up': 'Wyżej na liście', 'rack.down': 'Niżej na liście',
  'f.name': 'Nazwa', 'f.location': 'Lokalizacja', 'f.notes': 'Notatki', 'f.prefix': 'Prefiks etykiet', 'f.rack': 'Rack', 'f.kind': 'Typ', 'f.state': 'Stan',
  'f.ports': 'Porty RJ45 / LC', 'f.sfp': 'Porty SFP (uplink)', 'f.model': 'Model / producent',
  'f.portStatus': 'Status portu', 'f.link': 'Patchcord — drugi koniec', 'f.dest': 'Dokąd prowadzi (lokalizacja / gniazdo)', 'f.endpoint': 'Urządzenie końcowe',
  'f.vlan': 'VLAN', 'f.color': 'Kolor patchcorda', 'f.length': 'Długość (m)', 'f.cord': 'Etykieta na kablu', 'f.plan': 'Plan po przebudowie',
  'f.verified': 'Zweryfikowany fizycznie (test kabla / link)',
  'ph.rackName': 'np. Serwerownia', 'ph.rackLoc': 'np. budynek B, pokój 0.14', 'ph.prefix': 'np. B lub PKN01', 'ph.model': 'np. HPE Aruba 2530-48G',
  'ph.dest': 'np. Biuro 1.12, gniazdo 1.12-03', 'ph.endpoint': 'PC, drukarka, AP, kamera', 'ph.vlan': 'np. 10', 'ph.length': 'np. 1,5',
  'ph.cord': 'np. B07-PKN01-12', 'ph.plan': 'np. przenieść na PKN02:5, VLAN 20',
  'btn.save': 'Zapisz', 'btn.cancel': 'Anuluj', 'btn.delete': 'Usuń', 'btn.delSure': 'Usuń na pewno', 'btn.up': '▲ Wyżej', 'btn.down': '▼ Niżej',
  'btn.addDevice': '+ Urządzenie', 'btn.addDeviceLong': 'Dodaj urządzenie', 'btn.loadTemplate': 'Wczytaj układ racka',
  'btn.bulk': 'Zaznacz wiele', 'btn.bulkEnd': 'Zakończ zaznaczanie', 'btn.editDevice': 'Edytuj urządzenie',
  'btn.saveNext': 'Zapisz i dalej ›', 'btn.clearPort': 'Wyczyść port', 'btn.history': 'Historia zmian', 'btn.historyRefresh': 'Odśwież historię',
  'btn.close': 'Zamknij', 'btn.importYes': 'Importuj',
  'dev.formNew': 'Nowe urządzenie', 'dev.formEdit': 'Edycja urządzenia', 'dev.device': 'Urządzenie', 'dev.ports': '{n} portów',
  'dev.summary': 'zajęte {used} · wolne {free} · ? {unknown}',
  'loading': 'Wczytywanie racka…',
  'empty.rackTitle': 'Ten rack jest pusty', 'empty.rackText': 'Dodaj urządzenia albo przenieś je z innego racka (Edytuj urządzenie → Rack).',
  'empty.dbTitle': 'Rack jest pusty', 'empty.dbText': 'Wczytaj układ z inwentaryzacji (patchpanele A–H, switche PKN01–04, CAM patch, HPSW34, dwa żółte switche) albo dodaj urządzenia ręcznie.',
  'legend.verified': 'zweryfikowany', 'legend.cable': 'pasek = kolor kabla',
  'face.switch': 'nieparzyste u góry · parzyste u dołu', 'face.front': 'widok od frontu',
  'bulk.selected': '{n} zaznaczonych', 'bulk.verify': 'Oznacz jako zweryfikowane', 'bulk.all': 'Zaznacz wszystkie', 'bulk.none': 'Wyczyść',
  'table.port': 'Port', 'table.status': 'Status', 'table.link': 'Patchcord do', 'table.dest': 'Dokąd prowadzi', 'table.endpoint': 'Urządzenie',
  'table.vlan': 'VLAN', 'table.cable': 'Kabel', 'table.empty': 'Żaden port nie jest jeszcze opisany. Kliknij port, żeby zacząć.',
  'editor.pick': 'Wybierz port', 'editor.pickText': 'Kliknij gniazdo na froncie urządzenia, żeby opisać kabel, trasę i stan.',
  'editor.port': 'port {n}', 'editor.prev': 'Poprzedni port', 'editor.next': 'Następny port',
  'editor.conflict': 'Ktoś inny zmienił ten port w trakcie Twojej edycji. Teraz w bazie:', 'editor.conflict2': 'Poniżej są Twoje zmiany. Kliknij Zapisz, żeby je zachować.',
  'editor.emptyPort': 'pusty port', 'editor.lastChange': 'Ostatnia zmiana: {d}',
  'opt.none': '— brak —', 'opt.port': '— port —',
  'hint.link': 'Połączenie zapisuje się po obu stronach.', 'hint.linkOther': 'Może prowadzić też do innego racka.',
  'route.device': 'urządzenie: {x}', 'history.empty': 'Brak zapisanych zmian.',
  'results.count': 'Wyniki: {n}', 'results.none': 'Nic nie pasuje.',
  'toast.failed': 'Nie udało się: {msg}', 'toast.saved': 'Zapisano {x}', 'toast.cleared': 'Wyczyszczono port',
  'toast.clearConflict': 'Ktoś inny właśnie zmienił ten port. Sprawdź dane przed wyczyszczeniem.', 'toast.historyFail': 'Nie udało się pobrać historii',
  'toast.templateLoaded': 'Wczytano układ racka', 'toast.devAdded': 'Dodano urządzenie', 'toast.devSaved': 'Zapisano urządzenie',
  'toast.moved': 'Przeniesiono do racka „{x}”', 'toast.devDeleted': 'Usunięto urządzenie', 'toast.bulkChanged': 'Zmieniono portów: {n}',
  'toast.imported': 'Zaimportowano urządzeń: {n}', 'toast.rackName': 'Podaj nazwę racka', 'toast.rackAdded': 'Dodano rack „{x}”',
  'toast.rackSaved': 'Zapisano rack', 'toast.rackDeleted': 'Usunięto rack', 'toast.badJson': 'To nie jest poprawna kopia JSON',
  'confirm.leave': 'Port {x} ma niezapisane zmiany. Porzucić je?',
  'confirm.shrink': 'Po zmianie urządzenie będzie miało {total} portów. Opis {n} portów zostanie usunięty ({list}), a podłączone do nich patchcordy odpięte. Kontynuować?',
  'import.summary': 'Import nadpisze {what} o tych samych identyfikatorach razem z portami.', 'import.devices': 'urządzenia ({n})',
  'import.racks': 'i racki ({n})', 'import.where': 'Nowe urządzenia trafią do racka „{x}”.',
  'login.title': 'Logowanie', 'login.eyebrow': 'Szafa sieciowa', 'login.sub': 'Zaloguj się, żeby zobaczyć i edytować porty.',
  'login.user': 'Login', 'login.pass': 'Hasło', 'login.remember': 'Zapamiętaj mnie na tym urządzeniu (30 dni)', 'login.submit': 'Zaloguj się',
  'login.limit': 'Za dużo nieudanych prób. Logowanie z tego urządzenia jest zablokowane na 15 minut.', 'login.bad': 'Nieprawidłowy login lub hasło.',
  'login.expired': 'Sesja wygasła. Zaloguj się ponownie.', 'login.out': 'Wylogowano.',
  'err.dev_not_found': 'Nie ma urządzenia „{id}”', 'err.port_not_found': 'Port {n} nie istnieje w {dev}', 'err.self_link': 'Port nie może być połączony sam ze sobą',
  'err.port_conflict': 'Ktoś inny zmienił ten port w trakcie Twojej edycji.', 'err.bulk_missing': 'Wybierz status albo „zweryfikowany”',
  'err.bad_import': 'Niepoprawna kopia JSON', 'err.rack_not_found': 'Nie ma racka „{id}”',
  'err.rack_not_empty': 'W racku „{name}” są urządzenia ({n}). Przenieś je albo usuń.', 'err.last_rack': 'Musi zostać co najmniej jeden rack',
  'err.seed_not_empty': 'Układ z inwentaryzacji można wczytać tylko do pustej bazy', 'err.not_logged_in': 'Nie jesteś zalogowany albo sesja wygasła',
  'err.too_many_attempts': 'Za dużo nieudanych prób logowania. Spróbuj ponownie za kilka minut.', 'err.api_not_found': 'Nie ma takiego adresu API',
  'err.server_error': 'Błąd serwera. Szczegóły są w logu aplikacji.', 'err.too_large': 'Za duży plik', 'err.bad_json': 'Niepoprawne dane',
},
en: {
  'zoom.in': 'Zoom in', 'zoom.out': 'Zoom out', 'zoom.fit': 'Fit', 'zoom.hint': 'Click a socket to edit the port. Ctrl + mouse wheel (or pinch) zooms in and out.',
  'f.preset': 'Model template (Aruba)', 'preset.custom': '— custom / other —',
  'app.title': 'Rack inventory',
  'mode.connecting': 'Connecting to server…', 'mode.online': 'Data in MySQL · refreshes every 20 s', 'mode.offline': 'No connection to server',
  'stats.ports': 'Ports', 'stats.verified': 'Verified',
  'banner.offline': 'The server is not responding. Changes will not be saved until the connection is back.',
  'banner.expired': 'Your session has expired. Sign in again, then come back here and save the port.', 'banner.expiredLink': 'Open sign-in in a new tab',
  'search.ph': 'Search: room, socket, VLAN, B12…', 'search.label': 'Search',
  'btn.json': 'JSON backup', 'btn.import': 'Import', 'btn.logout': 'Sign out',
  'theme.toDark': 'Switch to dark theme', 'theme.toLight': 'Switch to light theme', 'lang.label': 'Language',
  'status.unknown': 'To check', 'status.used': 'In use', 'status.free': 'Free', 'status.reserved': 'Reserved', 'status.broken': 'Broken',
  'kind.patch': 'Patch panel', 'kind.switch': 'Switch', 'kind.fiber': 'Fibre panel', 'kind.other': 'Other',
  'devstatus.active': 'Active', 'devstatus.unused': 'Unused', 'devstatus.remove': 'To be removed',
  'color.czarny': 'black', 'color.czerwony': 'red', 'color.niebieski': 'blue', 'color.zielony': 'green', 'color.pomarańczowy': 'orange',
  'color.biały': 'white', 'color.żółty': 'yellow', 'color.szary': 'grey', 'color.różowy': 'pink', 'color.turkusowy (światłowód)': 'turquoise (fibre)', 'color.none': 'none',
  'rack.label': 'Rack', 'rack.aria': 'Devices in the rack', 'rack.select': 'Select rack', 'rack.edit': 'Edit rack', 'rack.add': 'Add rack',
  'rack.top': 'Cabinet · top down', 'rack.noDevices': 'No devices', 'rack.this': 'This rack',
  'rack.formNew': 'New rack', 'rack.formEdit': 'Edit rack', 'rack.delOnlyEmpty': 'Only an empty rack can be deleted', 'rack.delete': 'Delete rack',
  'rack.up': 'Move up', 'rack.down': 'Move down',
  'f.name': 'Name', 'f.location': 'Location', 'f.notes': 'Notes', 'f.prefix': 'Label prefix', 'f.rack': 'Rack', 'f.kind': 'Type', 'f.state': 'State',
  'f.ports': 'RJ45 / LC ports', 'f.sfp': 'SFP ports (uplink)', 'f.model': 'Model / manufacturer',
  'f.portStatus': 'Port status', 'f.link': 'Patch cord — other end', 'f.dest': 'Leads to (location / socket)', 'f.endpoint': 'End device',
  'f.vlan': 'VLAN', 'f.color': 'Patch cord colour', 'f.length': 'Length (m)', 'f.cord': 'Cable label', 'f.plan': 'Plan after rebuild',
  'f.verified': 'Physically verified (cable test / link)',
  'ph.rackName': 'e.g. Server room', 'ph.rackLoc': 'e.g. building B, room 0.14', 'ph.prefix': 'e.g. B or PKN01', 'ph.model': 'e.g. HPE Aruba 2530-48G',
  'ph.dest': 'e.g. Office 1.12, socket 1.12-03', 'ph.endpoint': 'PC, printer, AP, camera', 'ph.vlan': 'e.g. 10', 'ph.length': 'e.g. 1.5',
  'ph.cord': 'e.g. B07-PKN01-12', 'ph.plan': 'e.g. move to PKN02:5, VLAN 20',
  'btn.save': 'Save', 'btn.cancel': 'Cancel', 'btn.delete': 'Delete', 'btn.delSure': 'Yes, delete', 'btn.up': '▲ Up', 'btn.down': '▼ Down',
  'btn.addDevice': '+ Device', 'btn.addDeviceLong': 'Add device', 'btn.loadTemplate': 'Load rack layout',
  'btn.bulk': 'Select multiple', 'btn.bulkEnd': 'Done selecting', 'btn.editDevice': 'Edit device',
  'btn.saveNext': 'Save and next ›', 'btn.clearPort': 'Clear port', 'btn.history': 'Change history', 'btn.historyRefresh': 'Refresh history',
  'btn.close': 'Close', 'btn.importYes': 'Import',
  'dev.formNew': 'New device', 'dev.formEdit': 'Edit device', 'dev.device': 'Device', 'dev.ports': '{n} ports',
  'dev.summary': 'in use {used} · free {free} · ? {unknown}',
  'loading': 'Loading rack…',
  'empty.rackTitle': 'This rack is empty', 'empty.rackText': 'Add devices or move them here from another rack (Edit device → Rack).',
  'empty.dbTitle': 'The rack is empty', 'empty.dbText': 'Load the surveyed layout (patch panels A–H, switches PKN01–04, CAM patch, HPSW34, two yellow switches) or add devices manually.',
  'legend.verified': 'verified', 'legend.cable': 'stripe = cable colour',
  'face.switch': 'odd on top · even below', 'face.front': 'front view',
  'bulk.selected': '{n} selected', 'bulk.verify': 'Mark as verified', 'bulk.all': 'Select all', 'bulk.none': 'Clear',
  'table.port': 'Port', 'table.status': 'Status', 'table.link': 'Patch cord to', 'table.dest': 'Leads to', 'table.endpoint': 'Device',
  'table.vlan': 'VLAN', 'table.cable': 'Cable', 'table.empty': 'No ports documented yet. Click a port to start.',
  'editor.pick': 'Select a port', 'editor.pickText': 'Click a socket on the device front to describe its cable, route and state.',
  'editor.port': 'port {n}', 'editor.prev': 'Previous port', 'editor.next': 'Next port',
  'editor.conflict': 'Someone else changed this port while you were editing. Now in the database:', 'editor.conflict2': 'Your changes are below. Click Save to keep them.',
  'editor.emptyPort': 'empty port', 'editor.lastChange': 'Last change: {d}',
  'opt.none': '— none —', 'opt.port': '— port —',
  'hint.link': 'The connection is saved on both ends.', 'hint.linkOther': 'It can also lead to another rack.',
  'route.device': 'device: {x}', 'history.empty': 'No recorded changes.',
  'results.count': 'Results: {n}', 'results.none': 'No matches.',
  'toast.failed': 'Failed: {msg}', 'toast.saved': 'Saved {x}', 'toast.cleared': 'Port cleared',
  'toast.clearConflict': 'Someone else just changed this port. Check the data before clearing it.', 'toast.historyFail': 'Could not load history',
  'toast.templateLoaded': 'Rack layout loaded', 'toast.devAdded': 'Device added', 'toast.devSaved': 'Device saved',
  'toast.moved': 'Moved to rack “{x}”', 'toast.devDeleted': 'Device deleted', 'toast.bulkChanged': 'Ports changed: {n}',
  'toast.imported': 'Devices imported: {n}', 'toast.rackName': 'Enter a rack name', 'toast.rackAdded': 'Rack “{x}” added',
  'toast.rackSaved': 'Rack saved', 'toast.rackDeleted': 'Rack deleted', 'toast.badJson': 'This is not a valid JSON backup',
  'confirm.leave': 'Port {x} has unsaved changes. Discard them?',
  'confirm.shrink': 'After this change the device will have {total} ports. The description of {n} ports will be deleted ({list}) and their patch cords disconnected. Continue?',
  'import.summary': 'The import will overwrite {what} with the same IDs, including their ports.', 'import.devices': 'devices ({n})',
  'import.racks': 'and racks ({n})', 'import.where': 'New devices will go to rack “{x}”.',
  'login.title': 'Sign in', 'login.eyebrow': 'Network cabinet', 'login.sub': 'Sign in to view and edit ports.',
  'login.user': 'Username', 'login.pass': 'Password', 'login.remember': 'Remember me on this device (30 days)', 'login.submit': 'Sign in',
  'login.limit': 'Too many failed attempts. Sign-in from this device is blocked for 15 minutes.', 'login.bad': 'Incorrect username or password.',
  'login.expired': 'Your session has expired. Please sign in again.', 'login.out': 'You have been signed out.',
  'err.dev_not_found': 'Device “{id}” does not exist', 'err.port_not_found': 'Port {n} does not exist on {dev}', 'err.self_link': 'A port cannot be connected to itself',
  'err.port_conflict': 'Someone else changed this port while you were editing.', 'err.bulk_missing': 'Choose a status or “verified”',
  'err.bad_import': 'Invalid JSON backup', 'err.rack_not_found': 'Rack “{id}” does not exist',
  'err.rack_not_empty': 'Rack “{name}” still contains devices ({n}). Move or delete them first.', 'err.last_rack': 'At least one rack must remain',
  'err.seed_not_empty': 'The surveyed layout can only be loaded into an empty database', 'err.not_logged_in': 'You are not signed in or your session has expired',
  'err.too_many_attempts': 'Too many failed sign-in attempts. Try again in a few minutes.', 'err.api_not_found': 'No such API address',
  'err.server_error': 'Server error. Details are in the application log.', 'err.too_large': 'File too large', 'err.bad_json': 'Invalid data',
},
nl: {
  'zoom.in': 'Inzoomen', 'zoom.out': 'Uitzoomen', 'zoom.fit': 'Passend', 'zoom.hint': 'Klik op een aansluiting om de poort te bewerken. Ctrl + muiswiel (of knijpen) zoomt in en uit.',
  'f.preset': 'Modelsjabloon (Aruba)', 'preset.custom': '— eigen / ander —',
  'app.title': 'Rack-inventarisatie',
  'mode.connecting': 'Verbinden met server…', 'mode.online': 'Gegevens in MySQL · ververst elke 20 s', 'mode.offline': 'Geen verbinding met de server',
  'stats.ports': 'Poorten', 'stats.verified': 'Geverifieerd',
  'banner.offline': 'De server reageert niet. Wijzigingen worden pas opgeslagen als de verbinding terug is.',
  'banner.expired': 'Je sessie is verlopen. Log opnieuw in, kom dan hier terug en sla de poort op.', 'banner.expiredLink': 'Inloggen openen in een nieuw tabblad',
  'search.ph': 'Zoeken: ruimte, aansluiting, VLAN, B12…', 'search.label': 'Zoeken',
  'btn.json': 'JSON-back-up', 'btn.import': 'Importeren', 'btn.logout': 'Uitloggen',
  'theme.toDark': 'Donker thema gebruiken', 'theme.toLight': 'Licht thema gebruiken', 'lang.label': 'Taal',
  'status.unknown': 'Nog te bepalen', 'status.used': 'In gebruik', 'status.free': 'Vrij', 'status.reserved': 'Gereserveerd', 'status.broken': 'Defect',
  'kind.patch': 'Patchpaneel', 'kind.switch': 'Switch', 'kind.fiber': 'Glasvezelpaneel', 'kind.other': 'Overig',
  'devstatus.active': 'In gebruik', 'devstatus.unused': 'Ongebruikt', 'devstatus.remove': 'Te verwijderen',
  'color.czarny': 'zwart', 'color.czerwony': 'rood', 'color.niebieski': 'blauw', 'color.zielony': 'groen', 'color.pomarańczowy': 'oranje',
  'color.biały': 'wit', 'color.żółty': 'geel', 'color.szary': 'grijs', 'color.różowy': 'roze', 'color.turkusowy (światłowód)': 'turquoise (glasvezel)', 'color.none': 'geen',
  'rack.label': 'Rack', 'rack.aria': 'Apparaten in het rack', 'rack.select': 'Rack kiezen', 'rack.edit': 'Rack bewerken', 'rack.add': 'Rack toevoegen',
  'rack.top': 'Kast · van boven naar beneden', 'rack.noDevices': 'Geen apparaten', 'rack.this': 'Dit rack',
  'rack.formNew': 'Nieuw rack', 'rack.formEdit': 'Rack bewerken', 'rack.delOnlyEmpty': 'Alleen een leeg rack kan worden verwijderd', 'rack.delete': 'Rack verwijderen',
  'rack.up': 'Omhoog in de lijst', 'rack.down': 'Omlaag in de lijst',
  'f.name': 'Naam', 'f.location': 'Locatie', 'f.notes': 'Notities', 'f.prefix': 'Labelprefix', 'f.rack': 'Rack', 'f.kind': 'Type', 'f.state': 'Status',
  'f.ports': 'RJ45/LC-poorten', 'f.sfp': 'SFP-poorten (uplink)', 'f.model': 'Model / fabrikant',
  'f.portStatus': 'Poortstatus', 'f.link': 'Patchkabel — andere kant', 'f.dest': 'Leidt naar (locatie / aansluiting)', 'f.endpoint': 'Eindapparaat',
  'f.vlan': 'VLAN', 'f.color': 'Kleur patchkabel', 'f.length': 'Lengte (m)', 'f.cord': 'Kabellabel', 'f.plan': 'Plan na verbouwing',
  'f.verified': 'Fysiek geverifieerd (kabeltest / link)',
  'ph.rackName': 'bijv. Serverruimte', 'ph.rackLoc': 'bijv. gebouw B, ruimte 0.14', 'ph.prefix': 'bijv. B of PKN01', 'ph.model': 'bijv. HPE Aruba 2530-48G',
  'ph.dest': 'bijv. Kantoor 1.12, aansluiting 1.12-03', 'ph.endpoint': 'pc, printer, AP, camera', 'ph.vlan': 'bijv. 10', 'ph.length': 'bijv. 1,5',
  'ph.cord': 'bijv. B07-PKN01-12', 'ph.plan': 'bijv. verplaatsen naar PKN02:5, VLAN 20',
  'btn.save': 'Opslaan', 'btn.cancel': 'Annuleren', 'btn.delete': 'Verwijderen', 'btn.delSure': 'Ja, verwijderen', 'btn.up': '▲ Omhoog', 'btn.down': '▼ Omlaag',
  'btn.addDevice': '+ Apparaat', 'btn.addDeviceLong': 'Apparaat toevoegen', 'btn.loadTemplate': 'Rackindeling laden',
  'btn.bulk': 'Meerdere selecteren', 'btn.bulkEnd': 'Selectie beëindigen', 'btn.editDevice': 'Apparaat bewerken',
  'btn.saveNext': 'Opslaan en volgende ›', 'btn.clearPort': 'Poort wissen', 'btn.history': 'Wijzigingsgeschiedenis', 'btn.historyRefresh': 'Geschiedenis verversen',
  'btn.close': 'Sluiten', 'btn.importYes': 'Importeren',
  'dev.formNew': 'Nieuw apparaat', 'dev.formEdit': 'Apparaat bewerken', 'dev.device': 'Apparaat', 'dev.ports': '{n} poorten',
  'dev.summary': 'in gebruik {used} · vrij {free} · ? {unknown}',
  'loading': 'Rack laden…',
  'empty.rackTitle': 'Dit rack is leeg', 'empty.rackText': 'Voeg apparaten toe of verplaats ze uit een ander rack (Apparaat bewerken → Rack).',
  'empty.dbTitle': 'Het rack is leeg', 'empty.dbText': 'Laad de geïnventariseerde indeling (patchpanelen A–H, switches PKN01–04, CAM patch, HPSW34, twee gele switches) of voeg apparaten handmatig toe.',
  'legend.verified': 'geverifieerd', 'legend.cable': 'streep = kabelkleur',
  'face.switch': 'oneven boven · even onder', 'face.front': 'vooraanzicht',
  'bulk.selected': '{n} geselecteerd', 'bulk.verify': 'Markeren als geverifieerd', 'bulk.all': 'Alles selecteren', 'bulk.none': 'Wissen',
  'table.port': 'Poort', 'table.status': 'Status', 'table.link': 'Patchkabel naar', 'table.dest': 'Leidt naar', 'table.endpoint': 'Apparaat',
  'table.vlan': 'VLAN', 'table.cable': 'Kabel', 'table.empty': 'Nog geen poorten beschreven. Klik op een poort om te beginnen.',
  'editor.pick': 'Kies een poort', 'editor.pickText': 'Klik op een aansluiting aan de voorkant om kabel, route en status te beschrijven.',
  'editor.port': 'poort {n}', 'editor.prev': 'Vorige poort', 'editor.next': 'Volgende poort',
  'editor.conflict': 'Iemand anders heeft deze poort gewijzigd terwijl jij bezig was. Nu in de database:', 'editor.conflict2': 'Jouw wijzigingen staan hieronder. Klik op Opslaan om ze te behouden.',
  'editor.emptyPort': 'lege poort', 'editor.lastChange': 'Laatste wijziging: {d}',
  'opt.none': '— geen —', 'opt.port': '— poort —',
  'hint.link': 'De verbinding wordt aan beide kanten opgeslagen.', 'hint.linkOther': 'Ze kan ook naar een ander rack lopen.',
  'route.device': 'apparaat: {x}', 'history.empty': 'Geen wijzigingen opgeslagen.',
  'results.count': 'Resultaten: {n}', 'results.none': 'Geen resultaten.',
  'toast.failed': 'Mislukt: {msg}', 'toast.saved': '{x} opgeslagen', 'toast.cleared': 'Poort gewist',
  'toast.clearConflict': 'Iemand anders heeft deze poort net gewijzigd. Controleer de gegevens voordat je wist.', 'toast.historyFail': 'Geschiedenis laden mislukt',
  'toast.templateLoaded': 'Rackindeling geladen', 'toast.devAdded': 'Apparaat toegevoegd', 'toast.devSaved': 'Apparaat opgeslagen',
  'toast.moved': 'Verplaatst naar rack “{x}”', 'toast.devDeleted': 'Apparaat verwijderd', 'toast.bulkChanged': 'Poorten gewijzigd: {n}',
  'toast.imported': 'Apparaten geïmporteerd: {n}', 'toast.rackName': 'Geef een naam voor het rack op', 'toast.rackAdded': 'Rack “{x}” toegevoegd',
  'toast.rackSaved': 'Rack opgeslagen', 'toast.rackDeleted': 'Rack verwijderd', 'toast.badJson': 'Dit is geen geldige JSON-back-up',
  'confirm.leave': 'Poort {x} heeft niet-opgeslagen wijzigingen. Verwerpen?',
  'confirm.shrink': 'Na deze wijziging heeft het apparaat {total} poorten. De beschrijving van {n} poorten wordt verwijderd ({list}) en hun patchkabels worden losgekoppeld. Doorgaan?',
  'import.summary': 'De import overschrijft {what} met dezelfde ID’s, inclusief hun poorten.', 'import.devices': 'apparaten ({n})',
  'import.racks': 'en racks ({n})', 'import.where': 'Nieuwe apparaten komen in rack “{x}”.',
  'login.title': 'Inloggen', 'login.eyebrow': 'Netwerkkast', 'login.sub': 'Log in om poorten te bekijken en te bewerken.',
  'login.user': 'Gebruikersnaam', 'login.pass': 'Wachtwoord', 'login.remember': 'Onthoud mij op dit apparaat (30 dagen)', 'login.submit': 'Inloggen',
  'login.limit': 'Te veel mislukte pogingen. Inloggen vanaf dit apparaat is 15 minuten geblokkeerd.', 'login.bad': 'Onjuiste gebruikersnaam of wachtwoord.',
  'login.expired': 'Je sessie is verlopen. Log opnieuw in.', 'login.out': 'Je bent uitgelogd.',
  'err.dev_not_found': 'Apparaat “{id}” bestaat niet', 'err.port_not_found': 'Poort {n} bestaat niet op {dev}', 'err.self_link': 'Een poort kan niet met zichzelf verbonden worden',
  'err.port_conflict': 'Iemand anders heeft deze poort gewijzigd terwijl jij bezig was.', 'err.bulk_missing': 'Kies een status of „geverifieerd”',
  'err.bad_import': 'Ongeldige JSON-back-up', 'err.rack_not_found': 'Rack “{id}” bestaat niet',
  'err.rack_not_empty': 'Rack “{name}” bevat nog apparaten ({n}). Verplaats of verwijder ze eerst.', 'err.last_rack': 'Er moet minstens één rack overblijven',
  'err.seed_not_empty': 'De geïnventariseerde indeling kan alleen in een lege database worden geladen', 'err.not_logged_in': 'Je bent niet ingelogd of je sessie is verlopen',
  'err.too_many_attempts': 'Te veel mislukte inlogpogingen. Probeer het over een paar minuten opnieuw.', 'err.api_not_found': 'Dit API-adres bestaat niet',
  'err.server_error': 'Serverfout. Details staan in het applicatielogboek.', 'err.too_large': 'Bestand te groot', 'err.bad_json': 'Ongeldige gegevens',
},
cs: {
  'zoom.in': 'Přiblížit', 'zoom.out': 'Oddálit', 'zoom.fit': 'Přizpůsobit', 'zoom.hint': 'Kliknutím na zásuvku upravíte port. Ctrl + kolečko myši (nebo sevření prstů) přibližuje a oddaluje.',
  'f.preset': 'Šablona modelu (Aruba)', 'preset.custom': '— vlastní / jiný —',
  'app.title': 'Inventura racku',
  'mode.connecting': 'Připojování k serveru…', 'mode.online': 'Data v MySQL · obnovení každých 20 s', 'mode.offline': 'Bez spojení se serverem',
  'stats.ports': 'Porty', 'stats.verified': 'Ověřeno',
  'banner.offline': 'Server neodpovídá. Změny se neuloží, dokud se spojení neobnoví.',
  'banner.expired': 'Relace vypršela. Přihlaste se znovu, pak se sem vraťte a port uložte.', 'banner.expiredLink': 'Otevřít přihlášení v nové kartě',
  'search.ph': 'Hledat: místnost, zásuvka, VLAN, B12…', 'search.label': 'Hledat',
  'btn.json': 'Záloha JSON', 'btn.import': 'Import', 'btn.logout': 'Odhlásit',
  'theme.toDark': 'Přepnout na tmavý motiv', 'theme.toLight': 'Přepnout na světlý motiv', 'lang.label': 'Jazyk',
  'status.unknown': 'K ověření', 'status.used': 'Obsazený', 'status.free': 'Volný', 'status.reserved': 'Rezervovaný', 'status.broken': 'Vadný',
  'kind.patch': 'Patch panel', 'kind.switch': 'Switch', 'kind.fiber': 'Optický panel', 'kind.other': 'Jiné',
  'devstatus.active': 'V provozu', 'devstatus.unused': 'Nepoužívaný', 'devstatus.remove': 'K demontáži',
  'color.czarny': 'černá', 'color.czerwony': 'červená', 'color.niebieski': 'modrá', 'color.zielony': 'zelená', 'color.pomarańczowy': 'oranžová',
  'color.biały': 'bílá', 'color.żółty': 'žlutá', 'color.szary': 'šedá', 'color.różowy': 'růžová', 'color.turkusowy (światłowód)': 'tyrkysová (optika)', 'color.none': 'žádná',
  'rack.label': 'Rack', 'rack.aria': 'Zařízení v racku', 'rack.select': 'Vyberte rack', 'rack.edit': 'Upravit rack', 'rack.add': 'Přidat rack',
  'rack.top': 'Skříň · shora dolů', 'rack.noDevices': 'Žádná zařízení', 'rack.this': 'Tento rack',
  'rack.formNew': 'Nový rack', 'rack.formEdit': 'Úprava racku', 'rack.delOnlyEmpty': 'Smazat lze jen prázdný rack', 'rack.delete': 'Smazat rack',
  'rack.up': 'Posunout nahoru', 'rack.down': 'Posunout dolů',
  'f.name': 'Název', 'f.location': 'Umístění', 'f.notes': 'Poznámky', 'f.prefix': 'Prefix štítků', 'f.rack': 'Rack', 'f.kind': 'Typ', 'f.state': 'Stav',
  'f.ports': 'Porty RJ45 / LC', 'f.sfp': 'Porty SFP (uplink)', 'f.model': 'Model / výrobce',
  'f.portStatus': 'Stav portu', 'f.link': 'Propojovací kabel — druhý konec', 'f.dest': 'Vede do (umístění / zásuvka)', 'f.endpoint': 'Koncové zařízení',
  'f.vlan': 'VLAN', 'f.color': 'Barva propojovacího kabelu', 'f.length': 'Délka (m)', 'f.cord': 'Štítek na kabelu', 'f.plan': 'Plán po přestavbě',
  'f.verified': 'Fyzicky ověřeno (test kabelu / link)',
  'ph.rackName': 'např. Serverovna', 'ph.rackLoc': 'např. budova B, místnost 0.14', 'ph.prefix': 'např. B nebo PKN01', 'ph.model': 'např. HPE Aruba 2530-48G',
  'ph.dest': 'např. Kancelář 1.12, zásuvka 1.12-03', 'ph.endpoint': 'PC, tiskárna, AP, kamera', 'ph.vlan': 'např. 10', 'ph.length': 'např. 1,5',
  'ph.cord': 'např. B07-PKN01-12', 'ph.plan': 'např. přesunout na PKN02:5, VLAN 20',
  'btn.save': 'Uložit', 'btn.cancel': 'Zrušit', 'btn.delete': 'Smazat', 'btn.delSure': 'Ano, smazat', 'btn.up': '▲ Nahoru', 'btn.down': '▼ Dolů',
  'btn.addDevice': '+ Zařízení', 'btn.addDeviceLong': 'Přidat zařízení', 'btn.loadTemplate': 'Načíst uspořádání racku',
  'btn.bulk': 'Vybrat více', 'btn.bulkEnd': 'Ukončit výběr', 'btn.editDevice': 'Upravit zařízení',
  'btn.saveNext': 'Uložit a další ›', 'btn.clearPort': 'Vymazat port', 'btn.history': 'Historie změn', 'btn.historyRefresh': 'Obnovit historii',
  'btn.close': 'Zavřít', 'btn.importYes': 'Importovat',
  'dev.formNew': 'Nové zařízení', 'dev.formEdit': 'Úprava zařízení', 'dev.device': 'Zařízení', 'dev.ports': 'portů: {n}',
  'dev.summary': 'obsazeno {used} · volno {free} · ? {unknown}',
  'loading': 'Načítání racku…',
  'empty.rackTitle': 'Tento rack je prázdný', 'empty.rackText': 'Přidejte zařízení nebo je přesuňte z jiného racku (Upravit zařízení → Rack).',
  'empty.dbTitle': 'Rack je prázdný', 'empty.dbText': 'Načtěte zjištěné uspořádání (patch panely A–H, switche PKN01–04, CAM patch, HPSW34, dva žluté switche) nebo přidejte zařízení ručně.',
  'legend.verified': 'ověřeno', 'legend.cable': 'proužek = barva kabelu',
  'face.switch': 'liché nahoře · sudé dole', 'face.front': 'pohled zepředu',
  'bulk.selected': 'vybráno: {n}', 'bulk.verify': 'Označit jako ověřené', 'bulk.all': 'Vybrat vše', 'bulk.none': 'Zrušit výběr',
  'table.port': 'Port', 'table.status': 'Stav', 'table.link': 'Propojeno s', 'table.dest': 'Vede do', 'table.endpoint': 'Zařízení',
  'table.vlan': 'VLAN', 'table.cable': 'Kabel', 'table.empty': 'Zatím není popsán žádný port. Začněte kliknutím na port.',
  'editor.pick': 'Vyberte port', 'editor.pickText': 'Klikněte na zásuvku na přední straně zařízení a popište kabel, trasu a stav.',
  'editor.port': 'port {n}', 'editor.prev': 'Předchozí port', 'editor.next': 'Další port',
  'editor.conflict': 'Někdo jiný změnil tento port během vaší úpravy. Nyní v databázi:', 'editor.conflict2': 'Vaše změny jsou níže. Klikněte na Uložit, chcete-li je zachovat.',
  'editor.emptyPort': 'prázdný port', 'editor.lastChange': 'Poslední změna: {d}',
  'opt.none': '— žádný —', 'opt.port': '— port —',
  'hint.link': 'Propojení se uloží na obou koncích.', 'hint.linkOther': 'Může vést i do jiného racku.',
  'route.device': 'zařízení: {x}', 'history.empty': 'Žádné zaznamenané změny.',
  'results.count': 'Výsledky: {n}', 'results.none': 'Nic nenalezeno.',
  'toast.failed': 'Nepodařilo se: {msg}', 'toast.saved': 'Uloženo: {x}', 'toast.cleared': 'Port vymazán',
  'toast.clearConflict': 'Někdo jiný právě změnil tento port. Před vymazáním zkontrolujte údaje.', 'toast.historyFail': 'Historii se nepodařilo načíst',
  'toast.templateLoaded': 'Uspořádání racku načteno', 'toast.devAdded': 'Zařízení přidáno', 'toast.devSaved': 'Zařízení uloženo',
  'toast.moved': 'Přesunuto do racku „{x}“', 'toast.devDeleted': 'Zařízení smazáno', 'toast.bulkChanged': 'Změněno portů: {n}',
  'toast.imported': 'Importováno zařízení: {n}', 'toast.rackName': 'Zadejte název racku', 'toast.rackAdded': 'Rack „{x}“ přidán',
  'toast.rackSaved': 'Rack uložen', 'toast.rackDeleted': 'Rack smazán', 'toast.badJson': 'Toto není platná záloha JSON',
  'confirm.leave': 'Port {x} má neuložené změny. Zahodit je?',
  'confirm.shrink': 'Po změně bude mít zařízení {total} portů. Popis {n} portů bude smazán ({list}) a jejich propojovací kabely odpojeny. Pokračovat?',
  'import.summary': 'Import přepíše {what} se stejnými identifikátory včetně jejich portů.', 'import.devices': 'zařízení ({n})',
  'import.racks': 'a racky ({n})', 'import.where': 'Nová zařízení budou přidána do racku „{x}“.',
  'login.title': 'Přihlášení', 'login.eyebrow': 'Síťový rozvaděč', 'login.sub': 'Přihlaste se pro zobrazení a úpravu portů.',
  'login.user': 'Uživatelské jméno', 'login.pass': 'Heslo', 'login.remember': 'Zapamatovat na tomto zařízení (30 dní)', 'login.submit': 'Přihlásit se',
  'login.limit': 'Příliš mnoho neúspěšných pokusů. Přihlášení z tohoto zařízení je na 15 minut zablokováno.', 'login.bad': 'Nesprávné uživatelské jméno nebo heslo.',
  'login.expired': 'Relace vypršela. Přihlaste se znovu.', 'login.out': 'Byli jste odhlášeni.',
  'err.dev_not_found': 'Zařízení „{id}“ neexistuje', 'err.port_not_found': 'Port {n} na zařízení {dev} neexistuje', 'err.self_link': 'Port nelze propojit sám se sebou',
  'err.port_conflict': 'Někdo jiný změnil tento port během vaší úpravy.', 'err.bulk_missing': 'Vyberte stav nebo „ověřeno“',
  'err.bad_import': 'Neplatná záloha JSON', 'err.rack_not_found': 'Rack „{id}“ neexistuje',
  'err.rack_not_empty': 'V racku „{name}“ jsou zařízení ({n}). Nejprve je přesuňte nebo smažte.', 'err.last_rack': 'Musí zůstat alespoň jeden rack',
  'err.seed_not_empty': 'Zjištěné uspořádání lze načíst jen do prázdné databáze', 'err.not_logged_in': 'Nejste přihlášeni nebo relace vypršela',
  'err.too_many_attempts': 'Příliš mnoho neúspěšných pokusů o přihlášení. Zkuste to za pár minut.', 'err.api_not_found': 'Tato adresa API neexistuje',
  'err.server_error': 'Chyba serveru. Podrobnosti jsou v logu aplikace.', 'err.too_large': 'Soubor je příliš velký', 'err.bad_json': 'Neplatná data',
},
};

const PREF_LANG = 'rack-inventory.lang', PREF_THEME = 'rack-inventory.theme';
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* tryb prywatny itp. */ } };

function detectLang() {
  const saved = get(PREF_LANG);
  if (D[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || '']) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (D[code]) return code;
  }
  return 'en';
}
let lang = detectLang();
const root = document.documentElement;
root.lang = lang;

// t('klucz', {n: 3}) → tekst w bieżącym języku; brak tłumaczenia → polski → sam klucz.
function t(key, params) {
  let s = (D[lang] && D[lang][key]) ?? D.pl[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}
// Tłumaczy elementy statyczne: data-i18n (tekst), data-i18n-ph (placeholder), data-i18n-title, data-i18n-aria.
function apply(scope = document) {
  scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  scope.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
function setLang(l) {
  if (!D[l]) return;
  lang = l; root.lang = l; put(PREF_LANG, l);
  apply();
  document.dispatchEvent(new CustomEvent('langchange', { detail: l }));
}
// Wypełnia <select> listą języków i obsługuje zmianę.
function bindLangSelect(sel) {
  sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}"${k === lang ? ' selected' : ''}>${v}</option>`).join('');
  sel.addEventListener('change', () => setLang(sel.value));
}

/* motyw: data-theme na <html>; bez zapisanego wyboru obowiązuje motyw systemu */
const savedTheme = get(PREF_THEME);
if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
function currentTheme() {
  return root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function bindThemeButton(btn) {
  const paint = () => {
    const dark = currentTheme() === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    const label = t(dark ? 'theme.toLight' : 'theme.toDark');
    btn.title = label; btn.setAttribute('aria-label', label);
  };
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next; put(PREF_THEME, next); paint();
  });
  document.addEventListener('langchange', paint);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paint);
  paint();
}

window.i18n = { t, apply, setLang, bindLangSelect, bindThemeButton, dict: D, get lang() { return lang; } };
})();
