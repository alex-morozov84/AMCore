-- Example business schema. Apply through your business module's migration.
CREATE TABLE core.fixture_import_control (
  id integer PRIMARY KEY CHECK (id = 1),
  paused boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO core.fixture_import_control (id) VALUES (1);
CREATE TABLE core.fixture_imports (
  id varchar(128) PRIMARY KEY,
  incarnation uuid NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state varchar(16) NOT NULL CHECK (state IN ('waiting','active','failed','completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "grant" varchar(16) NOT NULL DEFAULT 'none' CHECK ("grant" IN ('none','spent')),
  certainty varchar(16) NOT NULL DEFAULT 'none' CHECK (certainty IN ('none','accepted','unknown')),
  failure_code varchar(64) CHECK (failure_code ~ '^[A-Za-z0-9_-]{1,64}$'),
  finished timestamptz(3)
);
CREATE INDEX fixture_imports_state_id ON core.fixture_imports (state,id);
