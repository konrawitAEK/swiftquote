-- Dev-only seed data (no users: password hashes should be created by the backend's auth flow)
INSERT INTO organizations (name, slug, currency) VALUES ('Demo Co., Ltd.', 'demo', 'THB');
