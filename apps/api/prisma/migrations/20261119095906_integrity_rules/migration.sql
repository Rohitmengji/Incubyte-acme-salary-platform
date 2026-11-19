-- Integrity rules that Prisma's schema language cannot express (architecture.md §5, ADR-0003).
-- Prisma's drift detection ignores these objects, so test/integration/db-guards.test.ts asserts
-- that they exist (catalogue) and that they behave as intended.

-- Reference data
ALTER TABLE "currency"
  ADD CONSTRAINT "currency_code_format_chk" CHECK ("code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "currency_minor_units_chk" CHECK ("minor_units" BETWEEN 0 AND 4);

ALTER TABLE "country"
  ADD CONSTRAINT "country_code_format_chk" CHECK ("code" ~ '^[A-Z]{2}$');

-- Employees
ALTER TABLE "employee"
  ADD CONSTRAINT "employee_code_format_chk" CHECK ("employee_code" ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'),
  ADD CONSTRAINT "employee_email_lowercase_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "employee_termination_after_hire_chk"
    CHECK ("termination_date" IS NULL OR "termination_date" >= "hire_date"),
  ADD CONSTRAINT "employee_inactive_has_termination_chk"
    CHECK ("status" <> 'INACTIVE' OR "termination_date" IS NOT NULL),
  ADD CONSTRAINT "employee_version_positive_chk" CHECK ("version" > 0);

-- Salary periods [effective_from, effective_to)
ALTER TABLE "compensation"
  ADD CONSTRAINT "compensation_amount_positive_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "compensation_period_order_chk"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  ADD CONSTRAINT "compensation_version_positive_chk" CHECK ("version" > 0),
  ADD CONSTRAINT "compensation_no_overlap_excl"
    EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "exchange_rate"
  ADD CONSTRAINT "exchange_rate_positive_chk" CHECK ("rate_to_reporting" > 0);

ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_email_lowercase_chk" CHECK ("email" = lower("email"));

-- Append-only audit trail
CREATE FUNCTION "audit_log_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_mutation"();
