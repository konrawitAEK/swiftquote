-- Products: every quote line is a product (title and category come from it). stock NULL = not tracked.
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES product_categories(id),
    name VARCHAR(255) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    unit_cost NUMERIC(12, 2) NOT NULL CHECK (unit_cost >= 0),
    stock NUMERIC(12, 2) CHECK (stock >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, name)
);
CREATE INDEX idx_products_category ON products(category_id);

-- Lines keep the product and its cost at the time they were saved (NULL for older lines).
ALTER TABLE quote_items ADD COLUMN product_id UUID REFERENCES products(id);
ALTER TABLE quote_items ADD COLUMN unit_cost NUMERIC(12, 2);
CREATE INDEX idx_quote_items_product ON quote_items(product_id);

-- A discount is a percent of the line or a fixed amount for the whole line.
ALTER TABLE quote_items ADD COLUMN discount_type VARCHAR(10) NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent', 'amount'));
ALTER TABLE quote_items ADD COLUMN discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
UPDATE quote_items SET discount_value = discount_percent;
ALTER TABLE quote_items DROP COLUMN discount_percent;

-- Dev-only products (one per kind; laptops and mice track stock).
INSERT INTO products (id, organization_id, category_id, name, unit_price, unit_cost, stock) VALUES
    ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000030', 'CRM licence (per user / year)', 4500.00, 1800.00, NULL),
    ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000030', 'Hosting (per month)', 350.00, 120.00, NULL),
    ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000031', 'Website redesign', 45000.00, 28000.00, NULL),
    ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000031', 'Consulting (per hour)', 2000.00, 900.00, NULL),
    ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000032', 'Laptop 14-inch', 32900.00, 26500.00, 25),
    ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000032', 'Wireless mouse', 590.00, 310.00, 200);
