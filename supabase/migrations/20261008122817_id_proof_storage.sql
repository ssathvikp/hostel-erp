-- Private storage for resident ID proof copies (E5-T7).
--
-- Objects live at <hostel_id>/<resident_id>/<file>. The bucket is private:
-- files are only ever served through short-lived signed URLs, which Storage
-- issues only to a user these policies allow to read the object. A member
-- of another hostel cannot read, list, overwrite or delete a file even with
-- the exact path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-proofs', 'id-proofs', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The first folder must be a hostel the user belongs to, and the second a
-- resident of that hostel.
create or replace function private.id_proof_path_allowed(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.residents r
    where r.hostel_id::text = (storage.foldername(p_name))[1]
      and r.id::text = (storage.foldername(p_name))[2]
      and r.hostel_id in (select private.user_hostel_ids())
  );
$$;

grant execute on function private.id_proof_path_allowed(text) to authenticated;

create policy "id-proofs: members read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'id-proofs' and private.id_proof_path_allowed(name));

create policy "id-proofs: members upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'id-proofs' and private.id_proof_path_allowed(name));

create policy "id-proofs: members replace"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'id-proofs' and private.id_proof_path_allowed(name))
  with check (bucket_id = 'id-proofs' and private.id_proof_path_allowed(name));

create policy "id-proofs: members delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'id-proofs' and private.id_proof_path_allowed(name));
