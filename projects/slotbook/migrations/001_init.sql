-- 001_init: users, auth tokens, services, staff, working hours, bookings.
-- Money is stored in integer cents. Times are timestamptz (UTC on the wire);
-- working hours are local wall-clock times interpreted in BUSINESS_TZ.

create extension if not exists btree_gist;
create extension if not exists citext;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique check (char_length(email) <= 254),
  password_hash text   not null,
  name          text   not null check (char_length(name) between 1 and 100),
  phone         text   check (phone is null or char_length(phone) <= 30),
  role          text   not null default 'customer' check (role in ('owner', 'staff', 'customer')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Refresh tokens are opaque; only their SHA-256 is stored. Tokens issued from
-- one login share a family so reuse of a rotated token can revoke them all.
create table refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  family_id   uuid not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

create table services (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (char_length(name) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 500),
  duration_min integer not null check (duration_min between 5 and 480 and duration_min % 5 = 0),
  price_cents  integer not null check (price_cents between 0 and 1000000),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table staff_profiles (
  user_id      uuid primary key references users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio          text not null default '' check (char_length(bio) <= 300),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table staff_services (
  staff_id   uuid not null references staff_profiles (user_id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  primary key (staff_id, service_id)
);

-- ISO weekday: 1 = Monday ... 7 = Sunday
create table working_hours (
  id         bigint generated always as identity primary key,
  staff_id   uuid not null references staff_profiles (user_id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time)
);
create index working_hours_staff_idx on working_hours (staff_id, weekday);

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references users (id) on delete cascade,
  staff_id      uuid not null references staff_profiles (user_id),
  service_id    uuid not null references services (id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'confirmed'
                check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  price_cents   integer not null check (price_cents >= 0),
  notes         text not null default '' check (char_length(notes) <= 500),
  cancelled_at  timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  -- The core invariant: one person cannot hold two active bookings that overlap.
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create index bookings_customer_idx on bookings (customer_id, starts_at desc);
create index bookings_staff_time_idx on bookings (staff_id, starts_at);
create index bookings_status_time_idx on bookings (status, starts_at);
