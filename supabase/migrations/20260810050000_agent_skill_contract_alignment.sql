-- Align persisted Skill enums with backend/agent-runtime/contracts/tool.ts.
-- The Runtime contract is authoritative; Model Providers never define these values.

alter table public.agent_skill_versions
  drop constraint if exists agent_skill_versions_risk_check;
alter table public.agent_skill_versions
  add constraint agent_skill_versions_risk_check
  check (risk in ('read', 'write_reversible', 'financial_irreversible'));

alter table public.agent_skill_versions
  drop constraint if exists agent_skill_versions_side_effect_check;
alter table public.agent_skill_versions
  add constraint agent_skill_versions_side_effect_check
  check (side_effect in ('none', 'internal_write', 'external_write', 'funds'));

alter table public.agent_skill_versions
  drop constraint if exists agent_skill_versions_approval_policy_check;
alter table public.agent_skill_versions
  add constraint agent_skill_versions_approval_policy_check
  check (approval_policy in ('none', 'explicit', 'explicit_and_recent_auth'));
