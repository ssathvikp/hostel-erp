-- Spreadsheet import of rooms and residents (deferred MVP gap: getting an
-- owner's existing data in).
--
-- The app reads and validates the file with the same rules as the forms,
-- then hands every good row to one of these functions. Each is a single
-- INSERT, so a file either goes in whole or not at all: a room number or
-- resident that already exists rolls back the batch, exactly like
-- create_rooms_bulk. Both run as the caller, so RLS and column grants
-- decide who may import (owners for rooms, members for residents).
--
-- Resident ID numbers arrive already reduced to last 4 + keyed hash; the
-- full number never reaches the database.

create or replace function public.import_rooms(p_hostel_id uuid, p_rooms jsonb)
returns table (rooms_created integer, beds_created integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created integer;
  beds integer;
begin
  if jsonb_typeof(p_rooms) <> 'array' or jsonb_array_length(p_rooms) not between 1 and 500 then
    raise exception 'An import holds between 1 and 500 rooms'
      using errcode = 'P0001', hint = 'import_size';
  end if;

  with inserted as (
    insert into public.rooms (hostel_id, floor, room_number, sharing_type, capacity)
    select p_hostel_id, r.floor, r.room_number, r.sharing_type, r.capacity
      from jsonb_to_recordset(p_rooms) as r (room_number text, floor integer, sharing_type text, capacity integer)
    returning capacity
  )
  select count(*)::integer, coalesce(sum(capacity), 0)::integer into created, beds from inserted;

  return query select created, beds;
end;
$$;

create or replace function public.import_residents(p_hostel_id uuid, p_residents jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created integer;
begin
  if jsonb_typeof(p_residents) <> 'array' or jsonb_array_length(p_residents) not between 1 and 500 then
    raise exception 'An import holds between 1 and 500 residents'
      using errcode = 'P0001', hint = 'import_size';
  end if;

  insert into public.residents (
    hostel_id, full_name, phone, alt_phone, email, gender, dob,
    id_proof_type, id_proof_last4, id_proof_hash,
    guardian_name, guardian_phone, permanent_address, joining_date, notes
  )
  select
    p_hostel_id, r.full_name, r.phone, r.alt_phone, r.email, r.gender, r.dob,
    r.id_proof_type, r.id_proof_last4, r.id_proof_hash,
    r.guardian_name, r.guardian_phone, r.permanent_address, r.joining_date, r.notes
  from jsonb_to_recordset(p_residents) as r (
    full_name text, phone text, alt_phone text, email text, gender text, dob date,
    id_proof_type text, id_proof_last4 text, id_proof_hash text,
    guardian_name text, guardian_phone text, permanent_address text, joining_date date, notes text
  );
  get diagnostics created = row_count;
  return created;
end;
$$;

revoke execute on function public.import_rooms(uuid, jsonb) from public, anon;
revoke execute on function public.import_residents(uuid, jsonb) from public, anon;
grant execute on function public.import_rooms(uuid, jsonb) to authenticated;
grant execute on function public.import_residents(uuid, jsonb) to authenticated;
