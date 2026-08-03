# Security Policy

NarraOps is an early prototype. Treat every wallet, execution, authentication, and data-isolation feature as security-sensitive.

## Current security status

Real-fund execution is part of the live product when the production GMGN/signer providers are configured. The application must expose provider outages as unavailable/data-gap states, never as fabricated success or simulation. All irreversible launches and trades require authenticated actor scoping, durable idempotency, policy checks, explicit final confirmation, provider reconciliation, immutable audit, and operational monitoring.

## Supported security scope

Security reports are welcome for:

- secret exposure risks;
- private key, seed phrase, cookie, authorization header, or API key handling;
- authentication and account isolation flaws;
- Supabase RLS or user data isolation issues;
- SSRF, unsafe redirects, or unbounded external fetch behavior;
- execution-state confusion, especially `submitted` being treated as `confirmed`;
- idempotency, replay, or duplicate execution risks;
- unsafe wallet export, signing, or broadcast paths;
- dependency or supply-chain vulnerabilities;
- stored or reflected injection issues;
- unsafe logging of sensitive data.

## Out of scope

Do not perform:

- real-fund transactions as part of testing;
- phishing, social engineering, or credential collection;
- denial-of-service testing against hosted services;
- attacks against third-party APIs, launchpads, wallets, RPC providers, or social platforms;
- attempts to access data belonging to real users;
- public disclosure before a fix is available.

## Sensitive data rules

Never commit or log:

- private keys;
- seed phrases;
- wallet vault files;
- Supabase secret or service-role keys;
- API keys or bearer tokens;
- cookies;
- authorization headers;
- signing payload secrets;
- production database URLs;
- user phone numbers outside the intended authenticated data path.

Placeholder values are allowed when they are clearly non-secret, for example `REPLACE_IN_SECRET_MANAGER`.

## Agent and model boundary

The Agent may generate intent, plans, summaries, and reviewable cards.

The Agent must not:

- directly access private keys or seed phrases;
- directly sign transactions;
- bypass policy services;
- bypass user confirmation;
- treat a model response as an execution authorization;
- fabricate live data when an integration is disabled, unavailable, or unsupported;
- expose profitability scores or guaranteed-success claims.

## Execution boundary

Execution-related systems must preserve these distinctions:

- `planned` means an operation has been prepared.
- `signing` means signing is underway or requested.
- `submitted` means a transaction was sent to a network or provider.
- `confirmed` requires chain reconciliation and finality rules.

A submitted response is not a confirmed result.

## Reporting a vulnerability

Open a private communication channel with the maintainer before disclosing details publicly.

If GitHub private vulnerability reporting is enabled for this repository, use it. Otherwise, contact the repository owner directly and include:

- a short description of the issue;
- affected files, routes, or workflows;
- reproduction steps;
- expected impact;
- whether any secret or user data may be exposed;
- suggested fix, if known.

Do not include real private keys, seed phrases, production tokens, or user data in a report.

## Fix standard

A security fix should include, where applicable:

- regression tests;
- updated API/schema contracts;
- updated handoff documentation;
- explicit notes about remaining blockers;
- confirmation that real-fund execution remains disabled unless the change is specifically reviewed to enable it.
