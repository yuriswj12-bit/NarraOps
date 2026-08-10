SELECT
  (
    SELECT count(*)
    FROM public.agent_tasks
    WHERE actor_id = '32000000-0000-4000-8000-000000000001'
  ) AS canary_tasks,
  has_function_privilege(
    'service_role',
    'public.agent_reserve_wallet_signed_execution_v1(jsonb,jsonb,integer,integer)',
    'execute'
  ) AS service_execute,
  has_function_privilege(
    'anon',
    'public.agent_reserve_wallet_signed_execution_v1(jsonb,jsonb,integer,integer)',
    'execute'
  ) AS anon_execute,
  has_function_privilege(
    'authenticated',
    'public.agent_reserve_wallet_signed_execution_v1(jsonb,jsonb,integer,integer)',
    'execute'
  ) AS authenticated_execute;
