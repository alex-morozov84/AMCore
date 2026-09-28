-- Read-only NDJSON report. Require successful psql exit AND the complete footer.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
WITH expected_permissions(id,action,subject,conditions,fields,inverted) AS (VALUES
('org-default-v2-read-org','read','Organization','{"id": "${user.organizationId}"}'::jsonb,ARRAY['id','name','slug','aclVersion','createdAt','updatedAt']::text[],false),
('org-default-v2-read-self','read','User','{"id": "${user.sub}"}'::jsonb,ARRAY['id','email','emailVerified','name','avatarUrl','phone','locale','timezone','createdAt','lastLoginAt']::text[],false),
('org-default-v2-update-self','update','User','{"id": "${user.sub}"}'::jsonb,ARRAY['name','locale','timezone']::text[],false),
('org-default-v2-update-org','update','Organization','{"id": "${user.organizationId}"}'::jsonb,ARRAY['name','slug']::text[],false),
('org-default-v2-delete-org','delete','Organization','{"id": "${user.organizationId}"}'::jsonb,ARRAY[]::text[],false),
('org-default-v2-team-access','manage','TeamAccess',NULL::jsonb,ARRAY[]::text[],false)), expected_links(name,permission_id) AS (VALUES ('VIEWER','org-default-v2-read-org'),('VIEWER','org-default-v2-read-self'),('MEMBER','org-default-v2-read-org'),('MEMBER','org-default-v2-read-self'),('MEMBER','org-default-v2-update-self'),('ADMIN','org-default-v2-read-org'),('ADMIN','org-default-v2-read-self'),('ADMIN','org-default-v2-update-self'),('ADMIN','org-default-v2-update-org'),('ADMIN','org-default-v2-delete-org'),('ADMIN','org-default-v2-team-access')),
legacy_links(name,action,subject,conditions) AS (VALUES ('ADMIN','manage','Organization',NULL::jsonb),('ADMIN','manage','Role',NULL::jsonb),('ADMIN','manage','Permission',NULL::jsonb),('ADMIN','manage','User',NULL::jsonb),('MEMBER','create','all',NULL::jsonb),('MEMBER','read','all',NULL::jsonb),('MEMBER','update','User','{"id": "${user.sub}"}'::jsonb),('VIEWER','read','all',NULL::jsonb)),
builtins AS (
 SELECT id,name,"isSystem" FROM core.roles
 WHERE "organizationId" IS NULL AND name IN ('ADMIN','MEMBER','VIEWER')
), builtin_shape AS (
 SELECT count(*)=3 AND count(DISTINCT name)=3 AND bool_and("isSystem") AS valid,
 count(*) AS role_count FROM builtins
), state AS (
 SELECT CASE
 WHEN (SELECT role_count FROM builtin_shape)=0 THEN 'clean'
 WHEN NOT (SELECT valid FROM builtin_shape) THEN 'unsupported'
 WHEN (SELECT count(*) FROM core.role_permissions rp JOIN builtins b ON b.id=rp."roleId")=11
 AND NOT EXISTS (
 SELECT 1 FROM expected_links e JOIN builtins b ON b.name=e.name
 JOIN expected_permissions spec ON spec.id=e.permission_id
 LEFT JOIN core.role_permissions rp ON rp."roleId"=b.id AND rp."permissionId"=e.permission_id
 LEFT JOIN core.permissions p ON p.id=rp."permissionId"
 WHERE p.id IS NULL OR p."organizationId" IS NOT NULL OR p.action<>spec.action
 OR p.subject<>spec.subject OR p.fields<>spec.fields OR p.inverted<>spec.inverted
 OR p.conditions IS DISTINCT FROM spec.conditions) THEN 'v2'
 WHEN (SELECT count(*) FROM core.role_permissions rp JOIN builtins b ON b.id=rp."roleId")=8
 AND (SELECT count(DISTINCT rp."permissionId") FROM core.role_permissions rp JOIN builtins b ON b.id=rp."roleId")=7
 AND NOT EXISTS (SELECT name,action,subject,conditions FROM legacy_links EXCEPT
 SELECT b.name,p.action,p.subject,p.conditions FROM builtins b JOIN core.role_permissions rp ON rp."roleId"=b.id
 JOIN core.permissions p ON p.id=rp."permissionId"
 WHERE p."organizationId" IS NULL AND NOT p.inverted AND cardinality(p.fields)=0) THEN 'legacy'
 ELSE 'unsupported' END AS template_state
), links AS (
 SELECT r.id AS role_id,r.name,r."organizationId" AS role_org,r."isSystem",p.*
 FROM core.roles r JOIN core.role_permissions rp ON rp."roleId"=r.id
 JOIN core.permissions p ON p.id=rp."permissionId"
), findings AS (
 SELECT 'UNSUPPORTED_TEMPLATES' AS code,NULL::text AS role_id,NULL::text AS permission_id
 WHERE (SELECT template_state FROM state)='unsupported'
 UNION ALL
 SELECT 'CUSTOM_POSITIVE_ALL',role_id,id FROM links
 WHERE subject='all' AND NOT inverted AND NOT (
 (SELECT template_state FROM state)='legacy' AND role_id IN (SELECT id FROM builtins))
 UNION ALL
 SELECT 'INVALID_RULE_SHAPE',role_id,id FROM links WHERE action NOT IN ('create','read','update','delete','manage')
 OR subject NOT IN ('User','Organization','Role','Permission','TeamAccess','all')
 OR (conditions IS NOT NULL AND jsonb_typeof(conditions)<>'object')
 OR array_position(fields,NULL) IS NOT NULL
 OR (subject='TeamAccess' AND (action<>'manage' OR (conditions IS NOT NULL AND conditions<>'{}'::jsonb)
   OR NOT (fields=ARRAY[]::text[] OR fields=ARRAY['*']::text[])))
 UNION ALL
 SELECT 'RESERVED_ID_MISMATCH',NULL,p.id FROM core.permissions p JOIN expected_permissions e ON p.id=e.id
 WHERE p."organizationId" IS NOT NULL OR p.action<>e.action OR p.subject<>e.subject
 OR p.conditions IS DISTINCT FROM e.conditions OR p.fields<>e.fields OR p.inverted<>e.inverted
 UNION ALL
 SELECT 'RESERVED_PERMISSION_COLLISION',NULL,p.id FROM core.permissions p
 WHERE (SELECT template_state FROM state)<>'v2' AND
 (p.id IN (SELECT id FROM expected_permissions) OR p.subject='TeamAccess')
 UNION ALL
 SELECT 'RESTRICTED_ORG_MANAGER',role_id,id FROM links
 WHERE subject='Organization' AND action='manage' AND NOT inverted
 AND ((conditions IS NOT NULL AND conditions<>'{}'::jsonb) OR NOT (fields=ARRAY[]::text[] OR fields=ARRAY['*']::text[]))
), effective_rules AS (
 SELECT mr."memberId" AS member_id,l.action,l.subject,l.inverted,l.conditions,l.fields
 FROM core.member_roles mr JOIN links l ON l.role_id=mr."roleId"
 JOIN core.org_members member ON member.id=mr."memberId"
 WHERE (l.role_org=member."organizationId" OR (l.role_org IS NULL AND l."isSystem"))
 AND (l."organizationId" IS NULL OR l."organizationId"=member."organizationId")
 AND NOT ((SELECT template_state FROM state)='legacy' AND l.role_id IN (SELECT id FROM builtins))
 UNION ALL
 SELECT mr."memberId",'manage','TeamAccess',false,NULL::jsonb,ARRAY[]::text[]
 FROM core.member_roles mr JOIN builtins b ON b.id=mr."roleId"
 WHERE (SELECT template_state FROM state)='legacy' AND b.name='ADMIN'
), membership AS (
 SELECT m.id,m."organizationId" AS org_id,
 EXISTS(SELECT 1 FROM effective_rules e WHERE e.member_id=m.id AND e.subject='TeamAccess'
   AND e.action='manage' AND NOT e.inverted AND (e.conditions IS NULL OR e.conditions='{}'::jsonb)
   AND (e.fields=ARRAY[]::text[] OR e.fields=ARRAY['*']::text[]))
 AND NOT EXISTS(SELECT 1 FROM effective_rules e WHERE e.member_id=m.id AND e.inverted
   AND e.subject IN ('TeamAccess','Role','Permission','User','all')) AS structural_team_access,
 EXISTS(SELECT 1 FROM core.member_roles mr JOIN links l ON l.role_id=mr."roleId"
   WHERE mr."memberId"=m.id AND l.action='manage' AND l.subject IN ('Organization','all') AND NOT l.inverted) AS coarse_candidate,
 EXISTS(SELECT 1 FROM core.member_roles mr JOIN builtins b ON b.id=mr."roleId"
   WHERE mr."memberId"=m.id AND b.name='ADMIN' AND b."isSystem") AS seeded_admin
 FROM core.org_members m
), org_counts AS (
 SELECT o.id,count(m.id) AS members,count(m.id) FILTER(WHERE m.structural_team_access) AS candidates,
 count(m.id) FILTER(WHERE m.coarse_candidate) AS coarse_candidates,
 count(m.id) FILTER(WHERE m.seeded_admin) AS seeded_admins
 FROM core.organizations o LEFT JOIN membership m ON m.org_id=o.id GROUP BY o.id
), output AS (
 SELECT 0 AS seq,'' AS sort_id,jsonb_build_object('type','header','reportVersion',2,
 'policyVersion','explicit-defaults/team-access-v2','templateState',(SELECT template_state FROM state),
 'structuralEligibility','upper_bound','runtimeProbeRequired',true) AS item
 UNION ALL
 SELECT 1,coalesce(role_id,'')||coalesce(permission_id,'')||code,
 jsonb_build_object('type','finding','code',code,'roleId',role_id,'permissionId',permission_id) FROM findings
 UNION ALL
 SELECT 2,id,jsonb_build_object('type','organization','organizationId',id,'members',members,
 'coarseCandidates',coarse_candidates,'structuralTeamCandidates',candidates,'seededAdmins',seeded_admins,
 'prediction',(SELECT template_state FROM state)='legacy','lockout',members>0 AND candidates=0,
 'runtimeProbeRequired',members>0) FROM org_counts
 UNION ALL
 SELECT 3,id,jsonb_build_object('type','member','memberId',id,'organizationId',org_id,
 'structuralTeamAccess',structural_team_access,'runtimeProbeRequired',true) FROM membership
 UNION ALL
 SELECT 4,id,jsonb_build_object('type','key_scope_change','keyId',id,'organizationId',"organizationId",
 'requiredScope','manage:TeamAccess') FROM core.api_keys
 WHERE 'manage:Organization'=ANY(scopes) AND NOT 'manage:TeamAccess'=ANY(scopes)
 UNION ALL
 SELECT 9,'',jsonb_build_object('type','footer','complete',true,'reportVersion',2,
 'findingCount',(SELECT count(*) FROM findings),'memberfulLockouts',(SELECT count(*) FROM org_counts WHERE members>0 AND candidates=0),
 'zeroMemberOrganizations',(SELECT count(*) FROM org_counts WHERE members=0),
 'blockingFindings',(SELECT count(*) FROM findings WHERE code<>'RESTRICTED_ORG_MANAGER'),
 'limitations',jsonb_build_array('SQL cannot prove native parser validity','Positive eligibility requires upgraded-clone runtime admission','No data was changed'))
)
SELECT item::text FROM output ORDER BY seq,sort_id;
COMMIT;
