// Układ racka z inwentaryzacji (od góry). Wczytywany przez `npm run db:seed`
// albo przyciskiem „Wczytaj układ racka” w pustej aplikacji.
// [id, nazwa, prefiks etykiet, typ, porty, SFP, stan, model, notatki]
module.exports = [
  ['pp-a', 'Patchpanel A', 'A', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['pp-b', 'Patchpanel B', 'B', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['pp-c', 'Patchpanel C', 'C', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['pp-d', 'Patchpanel D', 'D', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['pkn01', 'Switch PKN01', 'PKN01', 'switch', 48, 4, 'active', '', ''],
  ['pkn02', 'Switch PKN02', 'PKN02', 'switch', 48, 4, 'active', '', ''],
  ['pkn03', 'Switch PKN03', 'PKN03', 'switch', 48, 4, 'active', '', ''],
  ['pkn04', 'Switch PKN04', 'PKN04', 'switch', 48, 4, 'active', '', ''],
  ['cam-patch', 'CAM patch', 'CAM', 'patch', 24, 0, 'active', '', 'Patchpanel kamer'],
  ['hpsw34', 'HPSW34 · switch kamer', 'HPSW34', 'switch', 48, 4, 'active', '', ''],
  ['pp-e', 'Patchpanel E', 'E', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['pp-f', 'Patchpanel F', 'F', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['pp-g', 'Patchpanel G', 'G', 'patch', 24, 0, 'active', 'Legrand', ''],
  ['sw-yellow-1', 'Switch żółty 1', 'SWY1', 'switch', 24, 0, 'unused', '', 'Nieużywany. Liczbę portów popraw w edycji urządzenia.'],
  ['sw-yellow-2', 'Switch żółty 2', 'SWY2', 'switch', 24, 0, 'unused', '', 'Nieużywany. Liczbę portów popraw w edycji urządzenia.'],
  ['pp-h', 'Patchpanel H', 'H', 'patch', 24, 0, 'active', 'Legrand', ''],
];
