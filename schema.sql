PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS points (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  waste_type TEXT NOT NULL,
  recyclable INTEGER NOT NULL CHECK (recyclable IN (0, 1)),
  sensor_id TEXT NOT NULL UNIQUE,
  capacity_l INTEGER NOT NULL CHECK (capacity_l > 0),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_readings (
  point_id TEXT NOT NULL REFERENCES points(id),
  day TEXT NOT NULL,
  occupancy INTEGER NOT NULL CHECK (occupancy BETWEEN 0 AND 100),
  kg INTEGER NOT NULL CHECK (kg >= 0),
  recycled_kg INTEGER NOT NULL CHECK (recycled_kg BETWEEN 0 AND kg),
  PRIMARY KEY (point_id, day)
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES points(id),
  recorded_at TEXT NOT NULL,
  occupancy INTEGER NOT NULL CHECK (occupancy BETWEEN 0 AND 100),
  source TEXT NOT NULL CHECK (source IN ('sensor', 'collection'))
);

CREATE INDEX IF NOT EXISTS readings_by_point ON readings(point_id, id DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES points(id),
  level TEXT NOT NULL CHECK (level IN ('high', 'critical')),
  opened_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_alert ON alerts(point_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  distance_m INTEGER NOT NULL CHECK (distance_m >= 0)
);

CREATE TABLE IF NOT EXISTS route_stops (
  route_id INTEGER NOT NULL REFERENCES routes(id),
  point_id TEXT NOT NULL REFERENCES points(id),
  position INTEGER NOT NULL CHECK (position > 0),
  occupancy INTEGER NOT NULL CHECK (occupancy BETWEEN 0 AND 100),
  estimated_occupancy INTEGER NOT NULL CHECK (estimated_occupancy BETWEEN 0 AND 100),
  leg_m INTEGER NOT NULL CHECK (leg_m >= 0),
  PRIMARY KEY (route_id, point_id),
  UNIQUE (route_id, position)
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES points(id),
  route_id INTEGER,
  responsible TEXT NOT NULL CHECK (length(trim(responsible)) BETWEEN 1 AND 80),
  recorded_at TEXT NOT NULL,
  previous_occupancy INTEGER NOT NULL CHECK (previous_occupancy BETWEEN 1 AND 100),
  FOREIGN KEY (route_id, point_id) REFERENCES route_stops(route_id, point_id),
  UNIQUE (route_id, point_id)
);

CREATE INDEX IF NOT EXISTS collections_by_point ON collections(point_id, id DESC);
