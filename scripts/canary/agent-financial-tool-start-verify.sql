SELECT
  (
    SELECT count(*)
    FROM public.agent_tasks
    WHERE actor_id = '30000000-0000-4000-8000-000000000001'
  ) AS canary_tasks,
  has_function_privilege(
    'service_role',
    'public.agent_begin_financial_tool_v1(jsonb)',
    'execute'
  ) AS service_execute,
  has_function_privilege(
    'anon',
    'public.agent_begin_financial_tool_v1(jsonb)',
    'execute'
  ) AS anon_execute,
  has_function_privilege(
    'authenticated',
    'public.agent_begin_financial_tool_v1(jsonb)',
    'execute'
  ) AS authenticated_execute;
