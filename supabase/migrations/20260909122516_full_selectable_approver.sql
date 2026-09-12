-- O aprovador da data de coleta passa a ser escolhido pelo criador do Full.
-- O vínculo fica no cabeçalho porque representa a responsabilidade vigente;
-- participantes anteriores continuam preservados para leitura e auditoria.

alter table public.oraculo_fulls
  add column approver_user_id uuid;

update public.oraculo_fulls
set approver_user_id = creator_user_id
where approver_user_id is null;

alter table public.oraculo_fulls
  alter column approver_user_id set not null;

create index oraculo_fulls_approver_idx
  on public.oraculo_fulls (approver_user_id, created_at desc);

alter table public.oraculo_full_participants
  drop constraint if exists oraculo_full_participants_participant_role_check;

alter table public.oraculo_full_participants
  add constraint oraculo_full_participants_participant_role_check
  check (participant_role in ('criador','logistica','aprovador','participante'));

insert into public.oraculo_full_participants (full_id, user_id, participant_role)
select f.id, f.approver_user_id, 'aprovador'
from public.oraculo_fulls f
on conflict (full_id, user_id) do nothing;

comment on column public.oraculo_fulls.approver_user_id is
  'Usuário escolhido pelo criador para aceitar ou rejeitar a data de coleta proposta pela logística.';

comment on column public.oraculo_full_participants.participant_role is
  'Papel de acesso do participante: criador, logística, aprovador ou participante adicional; o cabeçalho do Full guarda as responsabilidades vigentes.';
