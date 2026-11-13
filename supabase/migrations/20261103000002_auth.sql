-- Posting requires a Google account. Every room and message belongs to the user who made it, the
-- author name comes from that user's identity, never from the request, and nothing can be edited
-- or deleted through the API.

-- Nothing is deployed, so rows from before sign-in, which have no owner, are dropped.
truncate public.messages, public.rooms;

-- Deleting a user deletes what they posted, and their rooms with everything in them.
alter table public.rooms
  add column created_by uuid not null default auth.uid() references auth.users (id) on delete cascade;
alter table public.messages
  add column user_id uuid not null default auth.uid() references auth.users (id) on delete cascade;

-- One part of a name, made safe to show: NFC, without the characters that draw nothing or turn the
-- text around them (zero-width spaces, soft hyphens, bidi controls and the like; the zero-width
-- joiner stays, since emoji are built with it), with runs of whitespace as one space.
create function public.author_name_part(part text) returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(normalize(coalesce(part, ''), NFC),
      U&'[\00AD\034F\061C\115F\1160\17B4\17B5\180B-\180E\200B\200C\200E\200F\202A-\202E\2060-\2064\2066-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF9-\FFFB]',
      '', 'g'),
    '\s+', ' ', 'g'));
$$;

-- The first letter of a word, for "First L.": a combining mark cannot stand alone.
create function public.author_initial(word text) returns text
language sql
immutable
set search_path = ''
as $$
  select left(regexp_replace(word, U&'^[\0300-\036F\1AB0-\1AFF\1DC0-\1DFF\20D0-\20FF\FE20-\FE2F\200D]+', ''), 1);
$$;

-- "First L." from a sign-in identity: given and family name when the identity has them (Google may
-- not send them; a real sign-in sent only full_name and name), otherwise the first and last words of
-- the full name. The first part is cut so the whole fits the 32-character author limit, without a
-- joiner left dangling at the cut, and an identity with no usable name gives "Anonymous", so a post
-- never fails over a missing name.
create function public.format_author(identity jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_given text := public.author_name_part(identity ->> 'given_name');
  v_family text := public.author_name_part(identity ->> 'family_name');
  v_full text;
  v_words text[];
  v_first text;
  v_initial text := '';
  v_suffix text := '';
begin
  if v_given <> '' then
    v_first := v_given;
    v_initial := public.author_initial(v_family);
  else
    v_full := coalesce(nullif(public.author_name_part(identity ->> 'full_name'), ''), public.author_name_part(identity ->> 'name'));
    if v_full = '' then
      return 'Anonymous';
    end if;
    v_words := string_to_array(v_full, ' ');
    v_first := v_words[1];
    if cardinality(v_words) > 1 then
      v_initial := public.author_initial(v_words[cardinality(v_words)]);
    end if;
  end if;
  if v_initial <> '' then
    v_suffix := ' ' || v_initial || '.';
  end if;
  v_first := regexp_replace(left(v_first, 32 - char_length(v_suffix)), U&'\200D+$', '');
  if v_first = '' then
    return 'Anonymous';
  end if;
  return v_first || v_suffix;
end;
$$;

-- Whether the caller signed in with Google. Posting requires it: other sign-ins, such as an email
-- sign-up, which this stack cannot turn off without stopping the password sign-in tests use, carry
-- identity data the client chose, name included.
create function public.has_google_identity() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.identities i where i.user_id = auth.uid() and i.provider = 'google');
$$;

-- The caller's author name, or null when signed out or without a Google identity. It reads
-- auth.identities, which users cannot edit, not the user metadata that updateUser changes.
create function public.current_author_name() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.format_author(i.identity_data)
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'google'
  order by i.created_at desc
  limit 1;
$$;

-- Sets the author on every insert by a signed-in user, whatever was sent. Inserts with no user (the
-- service role, test setup) keep the author they give. Security definer to read auth.identities.
create function public.set_message_author() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.author := public.current_author_name();
  end if;
  return new;
end;
$$;

create trigger messages_author before insert on public.messages
  for each row execute function public.set_message_author();

-- Only users signed in with Google may write, as themselves, and only the columns a client should choose: where a
-- room is, and which room a message goes to with what text. Everything else is a default or a
-- trigger's. Nobody may update or delete.
drop policy "Anyone may create rooms, until sign-in" on public.rooms;
drop policy "Anyone may post messages, until sign-in" on public.messages;

create policy "Google users create rooms as themselves" on public.rooms
  for insert to authenticated with check (created_by = (select auth.uid()) and (select public.has_google_identity()));
create policy "Google users post as themselves" on public.messages
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.has_google_identity()));

revoke all on public.rooms, public.messages from anon, authenticated;
grant select on public.rooms, public.messages to anon, authenticated;
grant insert (lat, lng) on public.rooms to authenticated;
grant insert (room_id, body) on public.messages to authenticated;

-- The first message now takes no author. Supabase's default privileges let public, anon and
-- authenticated execute new functions, so a grant alone would leave it open to anon.
drop function public.create_room_with_message(double precision, double precision, text, text);

create function public.create_room_with_message(p_lat double precision, p_lng double precision, p_body text)
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
  insert into public.messages (room_id, body) values (v_room_id, p_body) returning * into v_message;
  select * into v_room from public.rooms where id = v_room_id;
  return json_build_object('room', row_to_json(v_room), 'message', row_to_json(v_message));
end;
$$;

revoke execute on function public.create_room_with_message(double precision, double precision, text) from public, anon;
grant execute on function public.create_room_with_message(double precision, double precision, text) to authenticated;
