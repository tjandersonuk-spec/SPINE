-- Phase 6, part one -- the visibility primitive.
--
-- The handover notes give each module its own audience table: issue_distribution
-- for issues, meeting_people for meetings, and more to come for risks and change
-- requests. Four tables meaning almost the same thing is four chances to get
-- "who can see this" subtly different, and the difference only ever surfaces as
-- a leak. So there is one jsonb column and one function, as §1a requires.
--
--   {"mode":"project"}                       everyone on the project (tasks)
--   {"mode":"named","people":[uuid,...]}     raiser + owner + those people (risks)
--   {"mode":"parties","companies":[uuid,...]} company trees + named people (change requests)
--   {"mode":"internal"}                      the host's own staff only (pre-construction)
--
-- Admin always sees everything, whichever mode applies.

create or replace function can_see(
  p_project uuid,
  p_visibility jsonb,
  -- The two people a distribution list must never lock out: whoever raised the
  -- record and whoever owns it. An early version let a narrow list hide an item
  -- from its own owner, which reads as the item having vanished.
  p_raised_by uuid default null,
  p_owner_profile uuid default null
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not can_see_project(p_project) then false
    when auth.uid() = p_raised_by or auth.uid() = p_owner_profile then true
    when exists (select 1 from projects p
                 where p.id = p_project and is_account_staff(p.organisation_id)) then true
    else case coalesce(p_visibility->>'mode', 'project')
      when 'project' then true
      when 'internal' then false        -- staff already returned true above
      when 'named' then
        exists (select 1 from jsonb_array_elements_text(
                  coalesce(p_visibility->'people', '[]'::jsonb)) x
                where x.value::uuid = auth.uid())
      when 'parties' then
        exists (select 1 from jsonb_array_elements_text(
                  coalesce(p_visibility->'people', '[]'::jsonb)) x
                where x.value::uuid = auth.uid())
        or exists (
          select 1
          from jsonb_array_elements_text(
                 coalesce(p_visibility->'companies', '[]'::jsonb)) x
          join companies c on c.id = x.value::uuid
          where c.project_id = p_project
            and c.id = my_company_on_project(p_project))
      else true
    end
  end;
$$;

comment on function can_see(uuid, jsonb, uuid, uuid) is
  'The only visibility rule. One primitive, four modes; admin and internal override.';

grant execute on function can_see(uuid, jsonb, uuid, uuid) to authenticated;

-- A visibility value that no mode understands would silently fall through to
-- "everyone", so it is rejected at write time instead.
create or replace function visibility_is_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select v is null
      or (jsonb_typeof(v) = 'object'
          and coalesce(v->>'mode','project') in ('project','named','parties','internal')
          and (v->'people' is null or jsonb_typeof(v->'people') = 'array')
          and (v->'companies' is null or jsonb_typeof(v->'companies') = 'array'));
$$;
