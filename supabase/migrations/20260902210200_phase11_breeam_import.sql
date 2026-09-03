-- Phase 11, part three -- the three imports.
--
-- Same contract as every other import in this product: a published template,
-- strict header validation, a preview of exactly what will change, rejected
-- rows handed back to fix, and nothing written until somebody applies. The
-- headers are checked in the browser against the template; the KEYS are
-- checked again here, because a whole-file rejection enforced only in the
-- client is not enforced.

-- The keys each template supplies, snake-cased from the published headers.
-- Named once so the client, the validator and the writer cannot drift.
create or replace function breeam_import_keys(p_kind text)
returns text[]
language sql
immutable
as $$
  select case p_kind
    when 'sections' then array['section_code','section_name','building_type',
                               'weighting_percent','stated_credits_available']
    when 'credits'  then array['section_code','issue_code','issue_title','requirement',
                               'advisory_note','type','credits_available',
                               'programme_task_id','offset_days']
    when 'minstd'   then array['issue_code','rating','credits_required','note']
  end;
$$;

grant execute on function breeam_import_keys(text) to authenticated;

-- Row-by-row validation. Returns every row with a verdict, so the preview can
-- show what will be created, what will be updated, and what was rejected and
-- why -- and so the rejects can go back out as a CSV.
--
-- A missing KEY is fatal for the whole file and raises rather than rejecting a
-- row: a tracker that half-imports is worse than one that is refused.
create or replace function breeam_import_validate(
  p_scheme uuid, p_kind text, p_rows jsonb
) returns table (line int, accepted boolean, why text, rec jsonb)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_want text[] := breeam_import_keys(p_kind);
  v_row jsonb;
  v_line int := 1;
  v_missing text[];
  v_rec jsonb;
  v_why text;
  v_num numeric;
begin
  if v_want is null then
    raise exception 'Unknown BREEAM import kind: %', p_kind using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'The file is empty' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1;
    select array_agg(k) into v_missing
    from unnest(v_want) k where not (v_row ? k);
    if v_missing is not null then
      raise exception 'Missing column(s): %. The template''s headers must be present and spelled exactly.',
        array_to_string(v_missing, ', ') using errcode = '22023';
    end if;
  end loop;

  v_line := 1;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1;
    v_why := null;
    v_rec := '{}'::jsonb;

    -- A wholly blank line is skipped, not rejected: trailing newlines are not
    -- the assessor's mistake.
    if not exists (select 1 from jsonb_each_text(v_row) t
                   where btrim(coalesce(t.value, '')) <> '') then
      continue;
    end if;

    if p_kind = 'sections' then
      v_rec := jsonb_build_object(
        'code',   btrim(coalesce(v_row->>'section_code', '')),
        'name',   btrim(coalesce(v_row->>'section_name', '')),
        'type',   btrim(coalesce(v_row->>'building_type', '')));
      if v_rec->>'code' = '' then v_why := 'Section Code is blank'; end if;
      if v_why is null then
        begin
          v_num := nullif(btrim(coalesce(v_row->>'weighting_percent', '')), '')::numeric;
          -- The template asks for a percentage and the maths wants a fraction.
          -- Converting here is what stops a section weighted 11 scoring eleven
          -- times the whole scheme.
          v_rec := v_rec || jsonb_build_object('weight',
            case when v_num is null then null else v_num / 100 end);
        exception when others then v_why := 'Weighting Percent is not a number';
        end;
      end if;
      if v_why is null then
        begin
          v_rec := v_rec || jsonb_build_object('stated',
            nullif(btrim(coalesce(v_row->>'stated_credits_available', '')), '')::numeric);
        exception when others then v_why := 'Stated Credits Available is not a number';
        end;
      end if;

    elsif p_kind = 'minstd' then
      v_rec := jsonb_build_object(
        'issue',  btrim(coalesce(v_row->>'issue_code', '')),
        'rating', btrim(coalesce(v_row->>'rating', '')),
        'note',   btrim(coalesce(v_row->>'note', '')));
      if v_rec->>'issue' = ''  then v_why := 'Issue Code is blank';
      elsif v_rec->>'rating' = '' then v_why := 'Rating is blank';
      end if;
      if v_why is null then
        begin
          v_rec := v_rec || jsonb_build_object('credits',
            coalesce(nullif(btrim(coalesce(v_row->>'credits_required', '')), '')::numeric, 0));
        exception when others then v_why := 'Credits Required is not a number';
        end;
      end if;
      if v_why is null and not exists (
        select 1 from breeam_issues i
        where i.scheme_id = p_scheme and i.code = v_rec->>'issue')
      then
        -- Not a rejection of the file: a minimum standard for an issue the
        -- scheme has not loaded yet is an orphan, reported so the assessor can
        -- see which import to run first.
        v_why := 'No issue ' || (v_rec->>'issue') || ' on this scheme';
      end if;

    else
      v_rec := jsonb_build_object(
        'section',     btrim(coalesce(v_row->>'section_code', '')),
        'issue',       btrim(coalesce(v_row->>'issue_code', '')),
        'issue_title', btrim(coalesce(v_row->>'issue_title', '')),
        'requirement', btrim(coalesce(v_row->>'requirement', '')),
        'note',        btrim(coalesce(v_row->>'advisory_note', '')),
        'uid',         nullif(btrim(coalesce(v_row->>'programme_task_id', '')), ''),
        -- Anything beginning "pre" is a prerequisite. The template says
        -- Credit or Prerequisite; a tracker migrated by hand says "Pre-req".
        'is_prerequisite',
          lower(btrim(coalesce(v_row->>'type', ''))) like 'pre%');
      if v_rec->>'issue' = '' then v_why := 'Issue Code is blank'; end if;
      if v_why is null then
        begin
          v_num := coalesce(
            nullif(btrim(coalesce(v_row->>'credits_available', '')), '')::numeric, 0);
          -- A prerequisite is pass or fail and carries no credits, whatever
          -- the file says.
          v_rec := v_rec || jsonb_build_object('credits',
            case when (v_rec->>'is_prerequisite')::boolean then 0 else v_num end);
        exception when others then v_why := 'Credits Available is not a number';
        end;
      end if;
      if v_why is null then
        begin
          v_rec := v_rec || jsonb_build_object('offset',
            coalesce(nullif(btrim(coalesce(v_row->>'offset_days', '')), '')::int, 0));
        exception when others then v_why := 'Offset Days is not a number';
        end;
      end if;
    end if;

    return query select v_line, v_why is null, v_why, v_rec;
  end loop;
end;
$$;

grant execute on function breeam_import_validate(uuid, text, jsonb) to authenticated;

-- What applying would change, without changing it. Counted from the same
-- validator the writer uses, so the preview cannot promise one thing and the
-- apply do another.
create or replace function breeam_import_preview(
  p_scheme uuid, p_kind text, p_rows jsonb
) returns table (creating int, updating int, rejected int)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with v as (select * from breeam_import_validate(p_scheme, p_kind, p_rows)),
  known as (
    select
      case p_kind
        when 'sections' then exists (
          select 1 from breeam_schemes s
          cross join lateral jsonb_array_elements(s.sections) sec
          where s.id = p_scheme and sec->>'code' = v.rec->>'code')
        when 'minstd' then exists (
          select 1 from breeam_issues i
          where i.scheme_id = p_scheme and i.code = v.rec->>'issue'
            and i.min_standards ? (v.rec->>'rating'))
        else exists (
          select 1 from breeam_issues i
          join tracked_items t on t.breeam_issue_id = i.id and t.kind = 'breeam'
          where i.scheme_id = p_scheme and i.code = v.rec->>'issue'
            and t.title = v.rec->>'requirement')
      end as seen,
      v.accepted
    from v
  )
  select
    count(*) filter (where accepted and not seen)::int,
    count(*) filter (where accepted and seen)::int,
    count(*) filter (where not accepted)::int
  from known;
$$;

grant execute on function breeam_import_preview(uuid, text, jsonb) to authenticated;

-- The write. One transaction, definer so it can touch the scheme columns that
-- are outside the update grant, and refused outright unless the caller may
-- change this project's set-up.
create or replace function breeam_import_apply(
  p_scheme uuid, p_kind text, p_rows jsonb, p_label text default null
) returns table (created int, updated int, rejected int)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_created int := 0;
  v_updated int := 0;
  v_rejected int := 0;
  v_rec jsonb;
  v_sections jsonb;
  v_weightings jsonb;
  v_types text[];
  v_type text;
  v_ix int;
  v_issue uuid;
  v_item uuid;
  v_avail numeric;
  v_ext jsonb;
  v_ref text;
begin
  select project_id into v_project from breeam_schemes where id = p_scheme;
  if v_project is null then
    raise exception 'No such scheme' using errcode = 'P0002';
  end if;
  if not can_write_project_setup(v_project) then
    raise exception 'Not permitted to load a BREEAM framework on this project'
      using errcode = '42501';
  end if;

  select count(*) filter (where not accepted) into v_rejected
  from breeam_import_validate(p_scheme, p_kind, p_rows);

  if p_kind = 'sections' then
    select sections, weightings, building_types
      into v_sections, v_weightings, v_types
    from breeam_schemes where id = p_scheme for update;

    for v_rec in
      select rec from breeam_import_validate(p_scheme, p_kind, p_rows) where accepted
    loop
      select ord - 1 into v_ix
      from jsonb_array_elements(v_sections) with ordinality as e(val, ord)
      where e.val->>'code' = v_rec->>'code'
      limit 1;

      if v_ix is null then
        v_sections := v_sections || jsonb_build_array(jsonb_strip_nulls(
          jsonb_build_object('code', v_rec->>'code',
                             'name', nullif(v_rec->>'name', ''),
                             'stated', v_rec->'stated')));
        v_created := v_created + 1;
      else
        -- A weighting file carries one row per section PER BUILDING TYPE, so
        -- the same section appears several times. A later row that does not
        -- state a name or a total must not erase one an earlier row gave:
        -- blank means "not specified here", never "clear it".
        v_sections := jsonb_set(v_sections, array[v_ix::text], jsonb_strip_nulls(
          jsonb_build_object(
            'code', v_rec->>'code',
            'name', coalesce(nullif(v_rec->>'name', ''),
                             v_sections -> v_ix ->> 'name'),
            'stated', case when jsonb_typeof(v_rec->'stated') = 'number'
                           then v_rec->'stated'
                           else v_sections -> v_ix -> 'stated' end)));
        v_updated := v_updated + 1;
      end if;

      v_type := nullif(v_rec->>'type', '');
      if v_type is not null then
        if not (v_type = any(v_types)) then
          v_types := v_types || v_type;
        end if;
        -- jsonb_set will not create an intermediate object: setting
        -- [type, code] on a map with no `type` key returns the map unchanged
        -- and every weighting silently fails to load. So the type's own key is
        -- made first, always.
        if not (v_weightings ? v_type) then
          v_weightings := jsonb_set(v_weightings, array[v_type], '{}'::jsonb, true);
        end if;
        if jsonb_typeof(v_rec->'weight') = 'number' then
          v_weightings := jsonb_set(
            v_weightings, array[v_type, v_rec->>'code'], v_rec->'weight', true);
        end if;
      end if;
    end loop;

    update breeam_schemes
       set sections = v_sections,
           weightings = v_weightings,
           building_types = v_types,
           -- The first type loaded becomes the active one. Leaving it null
           -- would weight every section zero and report the scheme as scoring
           -- nothing, which reads as a broken import rather than a missing
           -- choice.
           building_type = coalesce(building_type, v_types[1])
     where id = p_scheme;

  elsif p_kind = 'minstd' then
    for v_rec in
      select rec from breeam_import_validate(p_scheme, p_kind, p_rows) where accepted
    loop
      update breeam_issues i
         set min_standards = jsonb_set(
               i.min_standards, array[v_rec->>'rating'],
               jsonb_strip_nulls(jsonb_build_object(
                 'credits', v_rec->'credits',
                 'note', nullif(v_rec->>'note', ''))),
               true)
       where i.scheme_id = p_scheme and i.code = v_rec->>'issue'
       returning i.id into v_issue;
      if v_issue is not null then v_updated := v_updated + 1; end if;
      v_issue := null;
    end loop;

  else
    for v_rec in
      select rec from breeam_import_validate(p_scheme, p_kind, p_rows) where accepted
    loop
      select id into v_issue from breeam_issues
       where scheme_id = p_scheme and code = v_rec->>'issue';
      if v_issue is null then
        insert into breeam_issues (project_id, scheme_id, code, title, section, note)
        values (v_project, p_scheme, v_rec->>'issue',
                nullif(v_rec->>'issue_title', ''), nullif(v_rec->>'section', ''),
                null)
        returning id into v_issue;
        v_created := v_created + 1;
      else
        -- A title or a section already on the issue is the assessor's; the
        -- import fills a gap rather than overwriting an answer.
        update breeam_issues
           set title = coalesce(title, nullif(v_rec->>'issue_title', '')),
               section = coalesce(section, nullif(v_rec->>'section', ''))
         where id = v_issue;
      end if;

      -- A row with no requirement carries the issue's advisory wording only.
      if coalesce(v_rec->>'requirement', '') = '' then
        update breeam_issues
           set note = coalesce(note, nullif(v_rec->>'note', ''))
         where id = v_issue;
        continue;
      end if;

      select id into v_item from tracked_items
       where kind = 'breeam' and breeam_issue_id = v_issue
         and title = v_rec->>'requirement';

      v_avail := coalesce((v_rec->>'credits')::numeric, 0);

      if v_item is null then
        -- The reference is the issue code and an ordinal: read down a
        -- monospace column, 'Man 01.2' is a reference and the requirement text
        -- is not. The ordinal counts across the PROJECT and not the issue,
        -- because tracked_items is unique on (project, kind, reference) and a
        -- project holds several schemes -- two of which may both carry Man 01.
        v_ref := (v_rec->>'issue') || '.' ||
          (1 + (select count(*) from tracked_items
                 where project_id = v_project and kind = 'breeam'
                   and heading = v_rec->>'issue'))::text;
        insert into tracked_items (
          project_id, kind, reference, heading, title, prompt,
          breeam_issue_id, programme_task_uid, offset_days, anchor, ext)
        values (
          v_project, 'breeam', v_ref, v_rec->>'issue', v_rec->>'requirement',
          nullif(v_rec->>'note', ''), v_issue, v_rec->>'uid',
          coalesce((v_rec->>'offset')::int, 0), 'finish',
          jsonb_build_object(
            'is_prerequisite', (v_rec->>'is_prerequisite')::boolean,
            'credits_available', v_avail,
            'credits_targeted', 0,
            'credits_achieved', 0));
        v_created := v_created + 1;
      else
        -- The scheme is authoritative about how many credits exist, so a
        -- reduced total clamps what the team had claimed rather than being
        -- refused: the alternative is an import that fails on a row the
        -- assessor has every right to correct.
        select ext into v_ext from tracked_items where id = v_item;
        update tracked_items
           set prompt = coalesce(nullif(v_rec->>'note', ''), prompt),
               ext = v_ext || jsonb_build_object(
                 'is_prerequisite', (v_rec->>'is_prerequisite')::boolean,
                 'credits_available', v_avail,
                 'credits_targeted',
                   least(coalesce((v_ext->>'credits_targeted')::numeric, 0), v_avail),
                 'credits_achieved',
                   least(coalesce((v_ext->>'credits_achieved')::numeric, 0), v_avail))
         where id = v_item;
        v_updated := v_updated + 1;
      end if;
      v_item := null;
    end loop;
  end if;

  return query select v_created, v_updated, v_rejected;
end;
$$;

grant execute on function breeam_import_apply(uuid, text, jsonb, text) to authenticated;

-- Setting a credit's target and its achievement. Separate from a general
-- update because the numbers are what the score is built on: a value above
-- what the credit offers is refused here as well as by the ext constraint, so
-- the caller gets a sentence rather than a constraint name.
create or replace function set_breeam_credit(
  p_item uuid, p_targeted numeric, p_achieved numeric
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid; v_ext jsonb; v_avail numeric; v_pre boolean;
  v_vis jsonb; v_by uuid; v_owner uuid;
begin
  -- Definer, so RLS is not doing the filtering here: the audience has to be
  -- asked directly, or this function is a way round can_see().
  select t.project_id, t.ext, coalesce((t.ext->>'is_prerequisite')::boolean, false),
         t.visibility, t.created_by,
         (select pp.profile_id from project_people pp where pp.id = t.person_id)
    into v_project, v_ext, v_pre, v_vis, v_by, v_owner
  from tracked_items t where t.id = p_item and t.kind = 'breeam';
  if v_project is null or not can_see(v_project, v_vis, v_by, v_owner) then
    raise exception 'No such credit' using errcode = 'P0002';
  end if;
  if v_pre then
    raise exception 'A prerequisite is pass or fail and carries no credits'
      using errcode = '22023';
  end if;
  v_avail := coalesce((v_ext->>'credits_available')::numeric, 0);
  if p_targeted < 0 or p_achieved < 0 then
    raise exception 'Credits cannot be negative' using errcode = '22023';
  end if;
  if p_targeted > v_avail or p_achieved > v_avail then
    raise exception 'This credit offers % credit(s)', v_avail using errcode = '22023';
  end if;
  update tracked_items
     set ext = v_ext || jsonb_build_object('credits_targeted', p_targeted,
                                           'credits_achieved', p_achieved)
   where id = p_item;
end;
$$;

grant execute on function set_breeam_credit(uuid, numeric, numeric) to authenticated;
