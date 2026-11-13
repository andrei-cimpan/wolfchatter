-- A room's creator may delete it. Its messages go with it through messages.room_id's
-- `on delete cascade`, which runs as the table owner and so needs no delete right on messages:
-- nobody may delete a single message.

create policy "Creators delete their rooms" on public.rooms
  for delete to authenticated using (created_by = (select auth.uid()));
grant delete on public.rooms to authenticated;

-- Whether the caller may delete the room, read as a column (`select can_delete`), so the app need
-- not compare ids itself. Creator ids are still readable (see TASKS T8.4).
create function public.can_delete(room public.rooms)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(room.created_by = auth.uid(), false);
$$;

-- Readers with the room open learn of its deletion live. Realtime cannot filter deletions by row,
-- so every subscriber hears every room deletion and ignores the others; fine for a small userbase.
-- Publishing the table also streams its inserts and updates, created_by included, to anyone who
-- subscribes to them, which reads the same columns the API already serves.
alter publication supabase_realtime add table public.rooms;
