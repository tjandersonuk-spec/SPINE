-- The platform's default presentation is dark. This is the one schema touch the
-- restyle makes, and it changes no decision anybody took: no screen has ever
-- written organisations.theme, so every 'light' in it is the old column default
-- and not a choice. Rows are moved with the default so an account created before
-- today renders the same as one created after; an account that later picks
-- light through the customiser keeps light, because that will be a write and
-- this runs once.
alter table organisations alter column theme set default 'dark';
update organisations set theme = 'dark' where theme = 'light';
