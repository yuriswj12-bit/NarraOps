SELECT
  task_id,
  actor_id,
  conversation_id,
  type,
  status,
  channel,
  created_at
FROM public.agent_tasks
WHERE type = 'account.recent-summary'
  AND channel = 'api'
  AND created_at >= now() - interval '30 minutes'
ORDER BY created_at DESC;

SELECT
  users.user_id,
  identities.address,
  users.created_at,
  count(tasks.task_id) AS recent_summary_tasks
FROM public.web3_users AS users
JOIN public.web3_identities AS identities
  ON identities.user_id = users.user_id
LEFT JOIN public.agent_tasks AS tasks
  ON tasks.actor_id = users.user_id
  AND tasks.type = 'account.recent-summary'
  AND tasks.channel = 'api'
WHERE users.created_at >= now() - interval '30 minutes'
GROUP BY users.user_id, identities.address, users.created_at
ORDER BY users.created_at DESC;
