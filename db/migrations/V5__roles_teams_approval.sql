-- Roles: admin (users and teams), woc (sees all + dashboard), wo (approves for their teams),
-- rm (creates quotes), customer (signs their client's quotes).
ALTER TABLE organization_members DROP CONSTRAINT organization_members_role_check;
UPDATE organization_members
SET role = CASE role WHEN 'owner' THEN 'admin' WHEN 'manager' THEN 'woc' ELSE 'rm' END;
ALTER TABLE organization_members
    ADD CONSTRAINT organization_members_role_check CHECK (role IN ('admin', 'woc', 'wo', 'rm', 'customer'));

-- A team is led by one WO; RMs belong to at most one team.
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    wo_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, name)
);

ALTER TABLE organization_members
    ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    ADD COLUMN client_id UUID REFERENCES clients(id),
    -- Removing someone deactivates them so their quotes and history stay intact.
    ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;

-- Approval workflow.
ALTER TABLE quotes DROP CONSTRAINT quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN
    ('draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'rejected', 'expired'));
ALTER TABLE quotes ADD COLUMN created_by UUID REFERENCES users(id);
CREATE INDEX idx_quote_created_by ON quotes(created_by);

-- Audit trail; actor_user_id is NULL when a customer acts through the share link.
CREATE TABLE quote_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Insertion order; timestamps alone can tie.
    seq BIGSERIAL NOT NULL,
    quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id),
    action VARCHAR(30) NOT NULL CHECK (action IN
        ('created', 'updated', 'submitted', 'approved', 'returned', 'sent', 'viewed', 'accepted', 'rejected')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_quote_events_quote ON quote_events(quote_id, seq);
