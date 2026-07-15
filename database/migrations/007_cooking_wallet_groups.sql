BEGIN;

ALTER TABLE wallet_groups
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'general';

ALTER TABLE wallet_groups DROP CONSTRAINT IF EXISTS wallet_groups_purpose_check;
ALTER TABLE wallet_groups
  ADD CONSTRAINT wallet_groups_purpose_check CHECK (purpose IN ('general', 'cooking'));

CREATE OR REPLACE FUNCTION enforce_cooking_wallet_group_limit() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT purpose FROM wallet_groups WHERE wallet_group_id = NEW.wallet_group_id) = 'cooking'
     AND EXISTS (SELECT 1 FROM wallet_group_wallets WHERE wallet_group_id = NEW.wallet_group_id AND status = 'active') THEN
    RAISE EXCEPTION 'A cooking wallet group can contain exactly one active wallet';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_group_wallets_cooking_limit ON wallet_group_wallets;
CREATE TRIGGER wallet_group_wallets_cooking_limit
BEFORE INSERT ON wallet_group_wallets
FOR EACH ROW EXECUTE FUNCTION enforce_cooking_wallet_group_limit();

COMMIT;
