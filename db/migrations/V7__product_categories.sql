-- Product categories classify quote lines for the sales dashboard.
-- Categories are retired (active = false) rather than deleted so existing quotes keep their category.
CREATE TABLE product_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, name)
);

-- NULL for lines created before categories existed ("uncategorized").
ALTER TABLE quote_items ADD COLUMN category_id UUID REFERENCES product_categories(id);
CREATE INDEX idx_quote_items_category ON quote_items(category_id);
