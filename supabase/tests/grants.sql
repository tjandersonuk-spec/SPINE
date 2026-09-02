-- Table and function grants Supabase applies by default to the `authenticated`
-- role. Applied after the migrations, locally and in the hosted project alike.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
