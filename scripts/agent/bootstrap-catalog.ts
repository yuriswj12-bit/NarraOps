import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  AgentCatalogService,
  NARRAOPS_AGENT_V2,
  NARRAOPS_READ_SKILLS_V2,
  SupabaseAgentCatalogRepository,
} from "../../backend/agent-runtime/index.ts";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      agent: `${NARRAOPS_AGENT_V2.slug}@${NARRAOPS_AGENT_V2.version}`,
      skills: NARRAOPS_READ_SKILLS_V2.map((skill) => `${skill.slug}@${skill.version}`),
      note: "Pass --apply with server-only Supabase credentials to publish idempotently.",
    }, null, 2));
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error("Server-only Supabase credentials are required");
  }

  const supabase = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const catalog = new AgentCatalogService(new SupabaseAgentCatalogRepository(supabase));
  const actor = {
    actorId: randomUUID(),
    permissions: ["agent:admin"],
  };
  const agent = await catalog.publishAgent({ actor, ...NARRAOPS_AGENT_V2 });
  const publishedSkills = [];
  for (const definition of NARRAOPS_READ_SKILLS_V2) {
    const skill = await catalog.publishSkill({ actor, ...definition });
    await catalog.bindSkill({
      actor,
      agentVersionId: agent.agentVersionId,
      skillVersionId: skill.skillVersionId,
    });
    publishedSkills.push({
      slug: skill.slug,
      version: skill.version,
      skillVersionId: skill.skillVersionId,
    });
  }

  console.log(JSON.stringify({
    mode: "applied",
    agent: {
      slug: agent.slug,
      version: agent.version,
      agentVersionId: agent.agentVersionId,
    },
    skills: publishedSkills,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
