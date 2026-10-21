-- Dev-only: one login per role, all with password "password".
--   demo@swiftquote.dev   admin
--   woc@swiftquote.dev    woc
--   wo@swiftquote.dev     wo, leads Team Alpha (rm1, rm2)
--   wo2@swiftquote.dev    wo, leads Team Beta  (rm3)
--   rm1/rm2/rm3@swiftquote.dev  rm
--   buyer@acme.example    customer of Acme Corporation
--   buyer@globex.example  customer of Globex Ltd.
UPDATE users SET full_name = 'Demo Admin' WHERE id = '00000000-0000-4000-8000-000000000002';

INSERT INTO clients (id, organization_id, name, email) VALUES
    ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001',
     'Globex Ltd.', 'buyer@globex.example');

INSERT INTO users (id, email, password_hash, full_name)
SELECT v.id::uuid, v.email, u.password_hash, v.name
FROM users u, (VALUES
    ('00000000-0000-4000-8000-000000000010', 'woc@swiftquote.dev', 'Wanida Chai'),
    ('00000000-0000-4000-8000-000000000011', 'wo@swiftquote.dev', 'Somchai Wong'),
    ('00000000-0000-4000-8000-000000000012', 'rm1@swiftquote.dev', 'Nok Rattana'),
    ('00000000-0000-4000-8000-000000000013', 'rm2@swiftquote.dev', 'Ploy Siri'),
    ('00000000-0000-4000-8000-000000000014', 'wo2@swiftquote.dev', 'Anan Boon'),
    ('00000000-0000-4000-8000-000000000015', 'rm3@swiftquote.dev', 'Mek Thong'),
    ('00000000-0000-4000-8000-000000000016', 'buyer@acme.example', 'Alice Acme'),
    ('00000000-0000-4000-8000-000000000017', 'buyer@globex.example', 'Gary Globex')
) AS v(id, email, name)
WHERE u.id = '00000000-0000-4000-8000-000000000002';

INSERT INTO teams (id, organization_id, name, wo_user_id) VALUES
    ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', 'Team Alpha',
     '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'Team Beta',
     '00000000-0000-4000-8000-000000000014');

INSERT INTO organization_members (organization_id, user_id, role, team_id, client_id) VALUES
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'woc', NULL, NULL),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'wo', NULL, NULL),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', 'rm',
     '00000000-0000-4000-8000-000000000020', NULL),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', 'rm',
     '00000000-0000-4000-8000-000000000020', NULL),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', 'wo', NULL, NULL),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000015', 'rm',
     '00000000-0000-4000-8000-000000000021', NULL),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000016', 'customer', NULL,
     '00000000-0000-4000-8000-000000000003'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000017', 'customer', NULL,
     '00000000-0000-4000-8000-000000000004');
