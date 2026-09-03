-- Phase 13, part four -- page three: the period, as a light narrative.
--
-- One row per section: a headline sentence, and detail lines whose presence is
-- itself audience-gated. A client gets the count; internal gets the list. Both
-- are true statements about the same period -- the difference is how much of
-- somebody else's working detail belongs in a document going out of the door.
create or replace function report_activity(
  p_project uuid, p_audience text, p_company uuid default null,
  p_kind text default 'week', p_end date default null
) returns table (
  sort_order int, section text, headline text, detail text[]
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_co uuid;
  v_period record;
  v_start date; v_end date;
  n1 int; n2 int;
  v_detail text[];
begin
  v_co := report_scope(p_project, p_audience, p_company);
  select * into v_period from report_period(p_kind, p_end);
  v_start := v_period.start_date; v_end := v_period.end_date;

  -- ------------------------------------------------------- milestones hit
  -- Client first, because a milestone met is the thing a client opens the
  -- document to find.
  if p_audience = 'client' then
    select array_agg(t.description || ' — completed ' || to_char(t.finish_date, 'DD Mon YYYY')
                     order by t.finish_date)
      into v_detail
    from programme_tasks t
    where t.project_id = p_project and not t.removed and t.percent_complete >= 100
      and t.finish_date between v_start and v_end;
    if v_detail is not null then
      return query select 1, 'Milestones'::text,
        cardinality(v_detail)::text || ' completed in the period.', v_detail;
    end if;
  end if;

  -- ---------------------------------------------------------- documents
  select count(distinct ti.drawing_id)::int, count(distinct tx.id)::int
    into n1, n2
  from transmittals tx
  join transmittal_items ti on ti.transmittal_id = tx.id
  join v_drawing_register r on r.id = ti.drawing_id
  where tx.project_id = p_project and tx.issue_date between v_start and v_end
    and (v_co is null
         or r.company_id in (select company_id from company_tree(p_project, v_co)));
  if n1 > 0 then
    -- A client gets the count; everybody else gets the list. Eight is where a
    -- list stops being read.
    if p_audience = 'client' then
      v_detail := '{}';
    else
      select array_agg(x.line) into v_detail from (
        select distinct r.document_number
               || coalesce(' — ' || r.title, '') as line
        from transmittals tx
        join transmittal_items ti on ti.transmittal_id = tx.id
        join v_drawing_register r on r.id = ti.drawing_id
        where tx.project_id = p_project and tx.issue_date between v_start and v_end
          and (v_co is null
               or r.company_id in (select company_id from company_tree(p_project, v_co)))
        order by 1 limit 8) x;
    end if;
    return query select 2, 'Documents'::text,
      n1::text || ' document' || case when n1 = 1 then '' else 's' end
      || ' issued across ' || n2::text || ' transmittal'
      || case when n2 = 1 then '' else 's' end || '.',
      coalesce(v_detail, '{}');
  end if;

  -- ----------------------------------------------------------- meetings
  select count(*)::int into n1 from meetings m
  where m.project_id = p_project and m.meeting_date between v_start and v_end;
  if n1 > 0 then
    if p_audience = 'internal' then
      select array_agg(to_char(m.meeting_date, 'DD Mon') || ' — ' || m.title
                       order by m.meeting_date)
        into v_detail
      from meetings m
      where m.project_id = p_project and m.meeting_date between v_start and v_end;
    else
      v_detail := '{}';
    end if;
    return query select 3, 'Meetings'::text,
      n1::text || ' meeting' || case when n1 = 1 then '' else 's' end || ' held.',
      coalesce(v_detail, '{}');
  end if;

  -- ------------------------------------------------------- tasks and RFIs
  -- Withheld from the client entirely: the raise-and-close churn between the
  -- contractor and its consultants is working detail, not a client's business.
  if p_audience <> 'client' then
    select count(*) filter (where i.raised_at::date between v_start and v_end)::int,
           count(*) filter (where i.closed_at::date between v_start and v_end)::int
      into n1, n2
    from issues i
    left join project_people pp on pp.id = i.person_id
    where i.project_id = p_project
      and (v_co is null
           or pp.company_id in (select company_id from company_tree(p_project, v_co)));
    if n1 > 0 or n2 > 0 then
      if p_audience = 'internal' then
        select array_agg(x.line) into v_detail from (
          select i.reference || ' — ' || i.title as line
          from issues i
          where i.project_id = p_project and i.closed_at::date between v_start and v_end
          order by i.closed_at desc limit 6) x;
      else
        v_detail := '{}';
      end if;
      return query select 4, 'Tasks and RFIs'::text,
        n1::text || ' raised, ' || n2::text || ' closed.', coalesce(v_detail, '{}');
    end if;
  end if;

  -- ------------------------------------------------------ change requests
  select count(*) filter (where cr.raised_at::date between v_start and v_end)::int,
         count(*) filter (where cr.decided_at::date between v_start and v_end)::int
    into n1, n2
  from change_requests cr
  where cr.project_id = p_project
    and (v_co is null
         or cr.from_company_id in (select company_id from company_tree(p_project, v_co))
         or cr.to_company_id in (select company_id from company_tree(p_project, v_co)));
  if n1 > 0 or n2 > 0 then
    if p_audience = 'client' then
      -- Title and outcome only. No reference, no classification, no impact.
      select array_agg(x.line) into v_detail from (
        select cr.title || ' — ' || cr.status as line
        from change_requests cr
        where cr.project_id = p_project and cr.decided_at::date between v_start and v_end
        order by cr.decided_at desc limit 6) x;
    else
      select array_agg(x.line) into v_detail from (
        select cr.reference || ' — ' || cr.title || ' (' || cr.status || ')' as line
        from change_requests cr
        where cr.project_id = p_project and cr.decided_at::date between v_start and v_end
          and (v_co is null
               or cr.from_company_id in (select company_id from company_tree(p_project, v_co))
               or cr.to_company_id in (select company_id from company_tree(p_project, v_co)))
        order by cr.decided_at desc limit 6) x;
    end if;
    return query select 5, 'Change requests'::text,
      n1::text || ' raised, ' || n2::text || ' decided.', coalesce(v_detail, '{}');
  end if;

  -- --------------------------------------------------------- checklists
  --
  -- Completions are not their own dated field. The change log already carries
  -- this as its ordinary trail, so it is read from there rather than by adding
  -- a column that would duplicate it -- and be one more thing to keep in step.
  select count(*)::int into n1
  from change_log l
  join tracked_items t on t.id = l.entity_id
  where l.project_id = p_project and l.entity_type = 'tracked_items'
    and l.field = 'status' and l.value_to in ('Complete','Discharged','Approved','Verified')
    and l.created_at::date between v_start and v_end
    and (p_audience <> 'client' or t.kind <> 'checklist:precon')
    and (v_co is null
         or t.company_id in (select company_id from company_tree(p_project, v_co)));
  if n1 > 0 then
    if p_audience = 'internal' then
      select array_agg(x.line) into v_detail from (
        select t.reference || ' — ' || t.title as line
        from change_log l
        join tracked_items t on t.id = l.entity_id
        where l.project_id = p_project and l.entity_type = 'tracked_items'
          and l.field = 'status'
          and l.value_to in ('Complete','Discharged','Approved','Verified')
          and l.created_at::date between v_start and v_end
        order by l.created_at desc limit 6) x;
    else
      v_detail := '{}';
    end if;
    return query select 6, 'Checklists and conditions'::text,
      n1::text || ' item' || case when n1 = 1 then '' else 's' end || ' completed.',
      coalesce(v_detail, '{}');
  end if;

  -- ---------------------------------------------------------- commercial
  -- No figures for the client at all -- not even a count of them.
  if p_audience <> 'client' then
    select count(*)::int into n1 from invoices v
    where v.project_id = p_project
      and (v.date_submitted between v_start and v_end
           or v.date_paid between v_start and v_end)
      and (v_co is null
           or v.company_id in (select company_id from company_tree(p_project, v_co)));
    select count(*)::int into n2 from payment_schedule s
    where s.project_id = p_project and s.agreed_at between v_start and v_end
      and (v_co is null
           or s.company_id in (select company_id from company_tree(p_project, v_co)));
    if n1 > 0 or n2 > 0 then
      return query select 7, 'Commercial'::text,
        n1::text || ' invoice' || case when n1 = 1 then '' else 's' end || ' moved, '
        || n2::text || ' instalment' || case when n2 = 1 then '' else 's' end || ' agreed.',
        '{}'::text[];
    end if;
  end if;

  -- --------------------------------------------------------- discussion
  -- Always present, even at zero: "nothing was said this period" is itself a
  -- finding, and a section that vanishes when empty hides it.
  select count(*)::int into n1 from comments c
  where c.project_id = p_project and c.created_at::date between v_start and v_end
    and (v_co is null
         or exists (select 1 from project_people pp
                    where pp.profile_id = c.author_id
                      and pp.company_id in (select company_id from company_tree(p_project, v_co))));
  return query select 8, 'Discussion'::text,
    n1::text || ' item' || case when n1 = 1 then '' else 's' end
    || ' of correspondence logged'
    || case when p_audience = 'client' then ' against the project record.' else '.' end,
    '{}'::text[];
end;
$$;

grant execute on function report_activity(uuid, text, uuid, text, date) to authenticated;
