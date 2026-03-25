-- 1. Create the profiles table
create table public.profiles (
   id uuid references auth.users not null primary key on delete cascade,
   nickname text unique,
   wins integer default 0,
   losses integer default 0,
   updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Security configuration (RLS)
alter table public.profiles enable row level security;

-- Policy: Everyone can view profiles (for leaderboards/social)
create policy "Public profiles are viewable by everyone" on public.profiles
   for select using (true);

-- Policy: Users can only update their own profile data
create policy "Users can update their own profile" on public.profiles
   for update using (auth.uid() = id);

-- 3. THE TRIGGER: Automatic profile creation on signup
-- This function runs every time a new user is created in auth.users
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id, 
    -- Try to get the nickname from metadata (sent from our JS signUp), 
    -- fallback to email + random part if not present
    coalesce(
        new.raw_user_meta_data->>'nickname', 
        split_part(new.email, '@', 1) || '-' || substr(new.id::text, 1, 4)
    )
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to execute the function after a new user is inserted into auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Atomic Increment function
create or replace function public.increment_stat(user_id uuid, column_name text)
returns integer
language plpgsql
security definer 
as $$
declare
  new_count integer;
begin
  if column_name = 'wins' then
    update public.profiles 
    set wins = wins + 1, updated_at = now()
    where id = user_id
    returning wins into new_count;
  elsif column_name = 'losses' then
    update public.profiles 
    set losses = losses + 1, updated_at = now()
    where id = user_id
    returning losses into new_count;
  else
    raise exception 'Invalid column name. Only "wins" or "losses" are allowed.';
  end if;

  return new_count;
end;
$$;
