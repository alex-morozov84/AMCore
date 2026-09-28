-- Explicit organization defaults: strict exact-state data upgrade, no guessed repairs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE core.organizations, core.org_members, core.member_roles, core.roles,
  core.role_permissions, core.permissions IN SHARE ROW EXCLUSIVE MODE;
SELECT pg_advisory_xact_lock(170017001);

CREATE TEMP TABLE expected_permissions (
 id text PRIMARY KEY, action text, subject text, conditions jsonb, fields text[], inverted boolean
) ON COMMIT DROP;
INSERT INTO expected_permissions VALUES
('org-default-v2-read-org','read','Organization','{"id": "${user.organizationId}"}'::jsonb,ARRAY['id','name','slug','aclVersion','createdAt','updatedAt']::text[],false),
('org-default-v2-read-self','read','User','{"id": "${user.sub}"}'::jsonb,ARRAY['id','email','emailVerified','name','avatarUrl','phone','locale','timezone','createdAt','lastLoginAt']::text[],false),
('org-default-v2-update-self','update','User','{"id": "${user.sub}"}'::jsonb,ARRAY['name','locale','timezone']::text[],false),
('org-default-v2-update-org','update','Organization','{"id": "${user.organizationId}"}'::jsonb,ARRAY['name','slug']::text[],false),
('org-default-v2-delete-org','delete','Organization','{"id": "${user.organizationId}"}'::jsonb,ARRAY[]::text[],false),
('org-default-v2-team-access','manage','TeamAccess',NULL::jsonb,ARRAY[]::text[],false);
CREATE TEMP TABLE expected_links (name text, permission_id text) ON COMMIT DROP;
INSERT INTO expected_links VALUES ('VIEWER','org-default-v2-read-org'),('VIEWER','org-default-v2-read-self'),('MEMBER','org-default-v2-read-org'),('MEMBER','org-default-v2-read-self'),('MEMBER','org-default-v2-update-self'),('ADMIN','org-default-v2-read-org'),('ADMIN','org-default-v2-read-self'),('ADMIN','org-default-v2-update-self'),('ADMIN','org-default-v2-update-org'),('ADMIN','org-default-v2-delete-org'),('ADMIN','org-default-v2-team-access');
CREATE TEMP TABLE legacy_links (name text, action text, subject text, conditions jsonb) ON COMMIT DROP;
INSERT INTO legacy_links VALUES ('ADMIN','manage','Organization',NULL::jsonb),('ADMIN','manage','Role',NULL::jsonb),('ADMIN','manage','Permission',NULL::jsonb),('ADMIN','manage','User',NULL::jsonb),('MEMBER','create','all',NULL::jsonb),('MEMBER','read','all',NULL::jsonb),('MEMBER','update','User','{"id": "${user.sub}"}'::jsonb),('VIEWER','read','all',NULL::jsonb);
CREATE TEMP TABLE builtin_roles ON COMMIT DROP AS
 SELECT id, name, "isSystem" FROM core.roles
 WHERE "organizationId" IS NULL AND name IN ('ADMIN','MEMBER','VIEWER');
CREATE TEMP TABLE affected_orgs (id text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE obsolete_permissions (id text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE seeded_admin_members (member_id text, role_id text) ON COMMIT DROP;

DO $upgrade$
DECLARE role_count integer; legacy boolean; exact_v2 boolean;
BEGIN
 SELECT count(*) INTO role_count FROM builtin_roles;
 IF role_count <> 0 AND (role_count <> 3 OR
   (SELECT count(DISTINCT name) FROM builtin_roles) <> 3 OR
   EXISTS (SELECT 1 FROM builtin_roles WHERE NOT "isSystem")) THEN
   RAISE EXCEPTION 'Unsupported builtin templates: missing/duplicate/non-system; run authorization audit';
 END IF;
 -- Positive-all custom links must be explicitly replaced before upgrade.
 IF EXISTS (SELECT 1 FROM core.role_permissions rp JOIN core.permissions p ON p.id=rp."permissionId"
   WHERE p.subject='all' AND NOT p.inverted AND NOT EXISTS (
     SELECT 1 FROM builtin_roles b WHERE b.id=rp."roleId")) THEN
   RAISE EXCEPTION 'Unsupported custom positive-all permission links; run authorization audit';
 END IF;
 IF role_count = 0 THEN
   IF EXISTS (SELECT 1 FROM core.permissions p WHERE p.id IN (SELECT id FROM expected_permissions)
     OR p.subject='TeamAccess') THEN RAISE EXCEPTION 'Reserved permission collision'; END IF;
   RETURN; -- Clean DB: guarded v2 seed initializes templates, not this migration.
 END IF;
 SELECT (SELECT count(*) FROM core.role_permissions rp JOIN builtin_roles b ON b.id=rp."roleId")=11
 AND NOT EXISTS (
   SELECT 1 FROM expected_links e JOIN builtin_roles b ON b.name=e.name
   LEFT JOIN core.role_permissions rp ON rp."roleId"=b.id AND rp."permissionId"=e.permission_id
   LEFT JOIN core.permissions p ON p.id=rp."permissionId"
   JOIN expected_permissions spec ON spec.id=e.permission_id
   WHERE p.id IS NULL OR p."organizationId" IS NOT NULL OR p.action<>spec.action
     OR p.subject<>spec.subject OR p.inverted<>spec.inverted OR p.fields<>spec.fields
     OR p.conditions IS DISTINCT FROM spec.conditions
 ) INTO exact_v2;
 IF exact_v2 THEN
   IF EXISTS (SELECT 1 FROM core.permissions WHERE subject='TeamAccess' AND
       (action<>'manage' OR (conditions IS NOT NULL AND conditions<>'{}'::jsonb)
        OR NOT (fields=ARRAY[]::text[] OR fields=ARRAY['*']::text[])))
     OR EXISTS (SELECT 1 FROM core.role_permissions rp JOIN core.permissions p ON p.id=rp."permissionId"
       WHERE p.subject='all' AND NOT p.inverted) THEN RAISE EXCEPTION 'Unsupported reserved/wildcard rules'; END IF;
   RETURN;
 END IF;
 SELECT (SELECT count(*) FROM core.role_permissions rp JOIN builtin_roles b ON b.id=rp."roleId")=8
 AND (SELECT count(DISTINCT rp."permissionId") FROM core.role_permissions rp
   JOIN builtin_roles b ON b.id=rp."roleId")=7
 AND NOT EXISTS (
   SELECT name, action, subject, conditions FROM legacy_links
   EXCEPT
   SELECT b.name,p.action,p.subject,p.conditions FROM builtin_roles b
     JOIN core.role_permissions rp ON rp."roleId"=b.id JOIN core.permissions p ON p.id=rp."permissionId"
     WHERE p."organizationId" IS NULL AND NOT p.inverted AND cardinality(p.fields)=0
 ) INTO legacy;
 IF NOT legacy THEN RAISE EXCEPTION 'Noncanonical installed templates: explicit audit/recovery required'; END IF;
 IF EXISTS (SELECT 1 FROM core.permissions p WHERE p.id IN (SELECT id FROM expected_permissions)
     OR p.subject='TeamAccess') THEN RAISE EXCEPTION 'Reserved permission collision'; END IF;
 INSERT INTO seeded_admin_members SELECT mr."memberId",mr."roleId" FROM core.member_roles mr
   JOIN builtin_roles b ON b.id=mr."roleId" WHERE b.name='ADMIN';
 INSERT INTO affected_orgs SELECT DISTINCT m."organizationId" FROM core.org_members m
   JOIN core.member_roles mr ON mr."memberId"=m.id JOIN builtin_roles b ON b.id=mr."roleId";
 -- Deterministic locks; stable membership/table locks already fence the affected set.
 PERFORM o.id FROM core.organizations o JOIN affected_orgs a ON a.id=o.id ORDER BY o.id FOR UPDATE OF o;
 INSERT INTO obsolete_permissions SELECT DISTINCT rp."permissionId" FROM core.role_permissions rp
   JOIN builtin_roles b ON b.id=rp."roleId";
 INSERT INTO core.permissions(id,action,subject,conditions,fields,inverted)
   SELECT id,action,subject,conditions,fields,inverted FROM expected_permissions;
 DELETE FROM core.role_permissions WHERE "roleId" IN (SELECT id FROM builtin_roles);
 INSERT INTO core.role_permissions("roleId","permissionId")
   SELECT b.id,e.permission_id FROM builtin_roles b JOIN expected_links e ON e.name=b.name;
 UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id IN (SELECT id FROM affected_orgs);
 DELETE FROM core.permissions p WHERE p.id IN (SELECT id FROM obsolete_permissions)
   AND NOT EXISTS (SELECT 1 FROM core.role_permissions rp WHERE rp."permissionId"=p.id);
 IF (SELECT count(*) FROM core.role_permissions rp JOIN builtin_roles b ON b.id=rp."roleId")<>11
   OR EXISTS (SELECT 1 FROM core.role_permissions rp JOIN core.permissions p ON p.id=rp."permissionId"
     WHERE p.subject='all' AND NOT p.inverted) THEN RAISE EXCEPTION 'Post-upgrade grant assertion failed'; END IF;
 IF EXISTS (SELECT member_id,role_id FROM seeded_admin_members EXCEPT
   SELECT "memberId","roleId" FROM core.member_roles) THEN
   RAISE EXCEPTION 'Seeded ADMIN membership identity changed'; END IF;
END
$upgrade$;
COMMIT;
