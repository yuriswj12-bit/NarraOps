-- Supabase may retain direct routine grants independently of PUBLIC.
-- The financial start boundary is service-role-only.

REVOKE ALL ON FUNCTION public.agent_begin_financial_tool_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_begin_financial_tool_v1(jsonb)
  TO service_role;
