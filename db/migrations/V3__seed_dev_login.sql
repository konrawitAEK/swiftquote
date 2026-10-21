-- Dev-only login and client. IDs match backend/go-service/internal/storage/memory/seed.go.
-- Login: demo@swiftquote.dev / password
UPDATE organizations SET id = '00000000-0000-4000-8000-000000000001' WHERE slug = 'demo';

INSERT INTO users (id, email, password_hash, full_name) VALUES
    ('00000000-0000-4000-8000-000000000002', 'demo@swiftquote.dev',
     '$2a$10$uYfAyrxO7at0lfUCLdJgLu3OcgIQj/se2t21fHhKJV5Sk4vj.0xEG', 'Demo Owner');

INSERT INTO organization_members (organization_id, user_id, role) VALUES
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'owner');

INSERT INTO clients (id, organization_id, name, email) VALUES
    ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
     'Acme Corporation', 'buyer@acme.example');
