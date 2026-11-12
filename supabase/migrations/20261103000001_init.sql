-- v1's schema (db/migrations/0001_init.sql on main), plus the functions the Supabase repository
-- calls over RPC, row-level security, and the Realtime publication. Posting stays open, as in v1,
-- until the auth migration.

create sequence public.room_number_seq;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null default ('Chatroom ' || nextval('public.room_number_seq')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  message_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  author text not null check (char_length(author) between 1 and 32),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index messages_room_created_idx on public.messages (room_id, created_at);
create index rooms_location_idx on public.rooms (lat, lng);

-- Keeps message_count in step with every insert. Live delivery is Realtime's, from the publication
-- at the end of this file, so unlike v1 the trigger sends no pg_notify. Security definer because
-- posters will have no right to update rooms; the empty search_path keeps such a function from
-- resolving names through a schema a caller controls.
create function public.on_message_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms set message_count = message_count + 1 where id = new.room_id;
  return new;
end;
$$;

create trigger messages_count after insert on public.messages
  for each row execute function public.on_message_insert();

-- The queries below are v1's, from PostgresChatRepository, moved here because the Supabase client
-- runs no raw SQL. They run as the caller (security invoker), so row-level security applies.

-- Messages are ordered by (created_at, id), a total order even when rows share a created_at, as
-- rows inserted in one transaction do. Cursors are message ids; one from another room, or unknown,
-- matches nothing, so the page is empty. Pages are always oldest first.
create function public.list_messages(p_room_id uuid, p_before uuid, p_after uuid, p_limit integer)
returns setof public.messages
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_before is not null and p_after is not null then
    raise exception 'list_messages accepts before or after, not both';
  end if;

  if p_after is not null then
    return query
      select m.* from public.messages m
      where m.room_id = p_room_id
        and (m.created_at, m.id) > (select c.created_at, c.id from public.messages c where c.id = p_after and c.room_id = p_room_id)
      order by m.created_at, m.id
      limit p_limit;
  elsif p_before is not null then
    return query
      select page.* from (
        select m.* from public.messages m
        where m.room_id = p_room_id
          and (m.created_at, m.id) < (select c.created_at, c.id from public.messages c where c.id = p_before and c.room_id = p_room_id)
        order by m.created_at desc, m.id desc
        limit p_limit
      ) page
      order by page.created_at, page.id;
  else
    return query
      select page.* from (
        select m.* from public.messages m
        where m.room_id = p_room_id
        order by m.created_at desc, m.id desc
        limit p_limit
      ) page
      order by page.created_at, page.id;
  end if;
end;
$$;

-- A viewport is one latitude range and two longitude ranges, which are the same range unless the
-- viewport crosses the antimeridian. At zoom 16 and above every room is returned, newest first.
create function public.list_rooms_in_view(
  p_south double precision,
  p_north double precision,
  p_from1 double precision,
  p_to1 double precision,
  p_from2 double precision,
  p_to2 double precision,
  p_limit integer
)
returns setof public.rooms
language sql
stable
set search_path = ''
as $$
  select r.* from public.rooms r
  where r.lat between p_south and p_north
    and (r.lng between p_from1 and p_to1 or r.lng between p_from2 and p_to2)
  order by r.created_at desc, r.id
  limit p_limit;
$$;

-- One row per grid cell of p_cell degrees. For a single-room cell the array_agg()[1] values are
-- that room's. Over the cap, the busiest cells win; among equally busy ones, those nearest the
-- centre, so the cap trims the padded edges the client asked for rather than whole rows of the
-- view. Longitude distance goes the short way round, for viewports that cross the antimeridian.
create function public.list_room_cells(
  p_south double precision,
  p_north double precision,
  p_from1 double precision,
  p_to1 double precision,
  p_from2 double precision,
  p_to2 double precision,
  p_cell double precision,
  p_center_lat double precision,
  p_center_lng double precision,
  p_limit integer
)
returns table (count integer, lat double precision, lng double precision, id uuid, title text, message_count integer)
language sql
stable
set search_path = ''
as $$
  select count(*)::integer, avg(r.lat), avg(r.lng),
         (array_agg(r.id))[1], (array_agg(r.title))[1], (array_agg(r.message_count))[1]
  from public.rooms r
  where r.lat between p_south and p_north
    and (r.lng between p_from1 and p_to1 or r.lng between p_from2 and p_to2)
  group by floor(r.lat / p_cell), floor(r.lng / p_cell)
  order by count(*) desc,
           power(avg(r.lat) - p_center_lat, 2)
             + power(least(abs(avg(r.lng) - p_center_lng), 360 - abs(avg(r.lng) - p_center_lng)), 2),
           floor(r.lat / p_cell), floor(r.lng / p_cell)
  limit p_limit;
$$;

-- A room and its first message in one transaction, so a refused message leaves no empty room on
-- the map. The room is read after the insert, whose trigger is what counts the message.
create function public.create_room_with_message(
  p_lat double precision,
  p_lng double precision,
  p_author text,
  p_body text
)
returns json
language plpgsql
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_message public.messages;
  v_room public.rooms;
begin
  insert into public.rooms (lat, lng) values (p_lat, p_lng) returning id into v_room_id;
  insert into public.messages (room_id, author, body) values (v_room_id, p_author, p_body) returning * into v_message;
  select * into v_room from public.rooms where id = v_room_id;
  return json_build_object('room', row_to_json(v_room), 'message', row_to_json(v_message));
end;
$$;

-- Anyone may read. Posting is open to everyone for now, as in v1; the auth migration replaces
-- these insert policies with ones for signed-in users. Nobody may update or delete.
alter table public.rooms enable row level security;
alter table public.messages enable row level security;

create policy "Rooms are public" on public.rooms for select using (true);
create policy "Messages are public" on public.messages for select using (true);
create policy "Anyone may create rooms, until sign-in" on public.rooms
  for insert to anon, authenticated with check (true);
create policy "Anyone may post messages, until sign-in" on public.messages
  for insert to anon, authenticated with check (true);

-- Live messages reach browsers through Supabase Realtime.
alter publication supabase_realtime add table public.messages;
