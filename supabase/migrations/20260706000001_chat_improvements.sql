-- is_favorite on conversations (pin important investigations)
alter table public.conversations
  add column if not exists is_favorite boolean not null default false;

create index if not exists idx_conversations_favorite
  on public.conversations (user_id)
  where is_favorite = true;

-- selected_model per user (overrides global app_config model)
alter table public.profiles
  add column if not exists selected_model text;
