-- Rack Inventory · schemat bazy (MySQL 8 / MariaDB 10.5+)
-- Skrypt jest idempotentny: można go uruchamiać wielokrotnie.

CREATE TABLE IF NOT EXISTS racks (
  id          VARCHAR(64)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  location    VARCHAR(255) NOT NULL DEFAULT '',
  notes       TEXT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Starsze bazy (bez kolumny rack_id) uzupełnia src/migrate.js przy starcie aplikacji.
CREATE TABLE IF NOT EXISTS devices (
  id          VARCHAR(64)  NOT NULL,
  rack_id     VARCHAR(64)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  short       VARCHAR(32)  NOT NULL,
  kind        ENUM('patch','switch','fiber','other') NOT NULL DEFAULT 'patch',
  port_count  SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  sfp         TINYINT  UNSIGNED NOT NULL DEFAULT 0,
  status      ENUM('active','unused','remove') NOT NULL DEFAULT 'active',
  model       VARCHAR(120) NOT NULL DEFAULT '',
  notes       TEXT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order (sort_order),
  KEY idx_rack (rack_id, sort_order),
  CONSTRAINT fk_devices_rack FOREIGN KEY (rack_id) REFERENCES racks (id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ports (
  device_id   VARCHAR(64) NOT NULL,
  port_no     SMALLINT UNSIGNED NOT NULL,
  status      ENUM('unknown','used','free','reserved','broken') NOT NULL DEFAULT 'unknown',
  link_device VARCHAR(64) NULL,
  link_port   SMALLINT UNSIGNED NULL,
  color       VARCHAR(40)  NULL,
  length      VARCHAR(20)  NULL,
  cord        VARCHAR(120) NULL,
  dest        VARCHAR(255) NULL,
  endpoint    VARCHAR(255) NULL,
  vlan        VARCHAR(40)  NULL,
  plan        VARCHAR(255) NULL,
  notes       TEXT NULL,
  verified    TINYINT(1) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, port_no),
  KEY idx_link (link_device, link_port),
  CONSTRAINT fk_ports_device FOREIGN KEY (device_id) REFERENCES devices (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historia zmian portów: stan przed każdą zmianą (JSON jako tekst dla zgodności z MariaDB).
CREATE TABLE IF NOT EXISTS port_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id   VARCHAR(64) NOT NULL,
  port_no     SMALLINT UNSIGNED NOT NULL,
  before_json TEXT NULL,
  after_json  TEXT NULL,
  changed_by  VARCHAR(64) NULL,
  changed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_port (device_id, port_no, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
