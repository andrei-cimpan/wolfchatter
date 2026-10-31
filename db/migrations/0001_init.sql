create sequence room_number_seq;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null default ('Chatroom ' || nextval('room_number_seq')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  message_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  author text not null check (char_length(author) between 1 and 32),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index messages_room_created_idx on messages (room_id, created_at);
create index rooms_location_idx on rooms (lat, lng);

-- One trigger keeps the pin badge count and real-time fan-out in step with every insert,
-- whichever app instance wrote the row.
create function on_message_insert() returns trigger as $$
begin
  update rooms set message_count = message_count + 1 where id = new.room_id;
  perform pg_notify('messages', row_to_json(new)::text);
  return new;
end;
$$ language plpgsql;

create trigger messages_notify after insert on messages
  for each row execute function on_message_insert();
