-- DESIGN ONLY: option A, secure containment, NOT restoration of browser access.
-- Requires explicit operational approval: temporarily disables Billing browser DB
-- access on six tables while retaining service-role APIs. No policies are removed.
begin;
set local lock_timeout='5s';
do $$ declare tab text; cols text; client text; col record; op text; begin
  if current_user <> 'postgres' then raise exception 'Trusted operator required'; end if;
  foreach tab in array array['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    select string_agg(quote_ident(attname),',') into cols from pg_attribute where attrelid=to_regclass('public.'||tab) and attnum>0 and not attisdropped;
    execute format('revoke select (%s),insert (%s),update (%s),references (%s) on public.%I from public,anon,authenticated',cols,cols,cols,cols,tab);
    foreach client in array array['anon','authenticated'] loop
      if has_table_privilege(client,'public.'||tab,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Inherited access prevents containment'; end if;
      for col in select attname from pg_attribute where attrelid=to_regclass('public.'||tab) and attnum>0 and not attisdropped loop
        if has_column_privilege(client,'public.'||tab,col.attname,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Inherited column access prevents containment'; end if;
      end loop;
    end loop;
    foreach op in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||tab,op) then raise exception 'Required service access missing'; end if;
    end loop;
  end loop;
end $$;
commit;
-- This intentionally invalidates the completed-state fingerprint. Subsequent repair
-- needs a reviewed forward correction, not blind rerun or historical restoration.
