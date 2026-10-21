-- CreateQuoteRequest.dealId has no deals table yet, so it is stored without a foreign key.
ALTER TABLE quotes ADD COLUMN deal_id UUID;

-- Preserve line item order as submitted.
ALTER TABLE quote_items ADD COLUMN position INT NOT NULL DEFAULT 0;
