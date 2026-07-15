import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.mjs";
import { createLogger } from "../src/security.mjs";

const testConfig = {
  bodyLimitBytes: 100_000,
  taskStepDelayMs: 5,
  sseHeartbeatMs: 1_000,
};

async function startApi() {
  const application = createApplication({ config: testConfig, logger: createLogger("silent") });
  await new Promise((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  const { port } = application.server.address();
  return { application, baseUrl: `http://127.0.0.1:${port}` };
}

async function post(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("portfolio supports every period and returns monetary values as strings", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  for (const period of ["1d", "7d", "30d", "all"]) {
    const response = await fetch(`${baseUrl}/api/v1/account/portfolio?period=${period}`);
    assert.equal(response.status, 200);
    const portfolio = await response.json();
    assert.equal(portfolio.period, period);
    for (const field of ["totalBalance", "turnover", "realizedPnl", "unrealizedPnl", "pnlPercent"]) {
      assert.equal(typeof portfolio[field], "string");
    }
    assert.ok(portfolio.history.length > 0);
    assert.ok(portfolio.history.every(({ totalBalance }) => typeof totalBalance === "string"));
  }
  const invalid = await fetch(`${baseUrl}/api/v1/account/portfolio?period=year`);
  assert.equal(invalid.status, 400);
});

test("wallet groups create simulated public references and can add wallets", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const createdResponse = await post(baseUrl, "/api/v1/wallet-groups", { name: "Launch Team", walletCount: 2 });
  assert.equal(createdResponse.status, 201);
  const group = await createdResponse.json();
  assert.equal(group.walletCount, 2);
  assert.equal(group.totalBalance, "0.00");

  const addedResponse = await post(baseUrl, `/api/v1/wallet-groups/${group.groupId}/wallets`, { count: 3 });
  assert.equal(addedResponse.status, 201);
  const added = await addedResponse.json();
  assert.equal(added.group.walletCount, 5);
  assert.equal(added.wallets.length, 3);
  assert.ok(added.wallets.every(({ provisioningStatus, exportEligible }) => provisioningStatus === "simulation_only" && exportEligible === false));
  assert.doesNotMatch(JSON.stringify(added), /privateKey|secretKey|mnemonic|seedPhrase/i);

  const listed = await fetch(`${baseUrl}/api/v1/wallet-groups/${group.groupId}/wallets`).then((response) => response.json());
  assert.equal(listed.wallets.length, 5);

  const cookingResponse = await post(baseUrl, "/api/v1/wallet-groups", { name: "Cooking Alpha", purpose: "cooking", walletCount: 1 });
  assert.equal(cookingResponse.status, 201);
  const cooking = await cookingResponse.json();
  assert.equal(cooking.purpose, "cooking");
  assert.equal(cooking.walletCount, 1);
  const rejectedExtraWallet = await post(baseUrl, `/api/v1/wallet-groups/${cooking.groupId}/wallets`, { count: 1 });
  assert.equal(rejectedExtraWallet.status, 400);

  const rejectedCookingGroup = await post(baseUrl, "/api/v1/wallet-groups", { name: "Invalid Cooking", purpose: "cooking", walletCount: 2 });
  assert.equal(rejectedCookingGroup.status, 400);
});

test("batch delete requires preview and confirmation while protecting non-zero balances", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const groups = await fetch(`${baseUrl}/api/v1/wallet-groups`).then((response) => response.json());
  const seeded = groups.groups.find(({ name }) => name === "Core Launch");
  const wallets = await fetch(`${baseUrl}/api/v1/wallet-groups/${seeded.groupId}/wallets`).then((response) => response.json());
  const selectedIds = wallets.wallets.map(({ walletId }) => walletId);

  const previewResponse = await post(baseUrl, `/api/v1/wallet-groups/${seeded.groupId}/wallets/batch-delete`, { walletIds: selectedIds });
  assert.equal(previewResponse.status, 202);
  const preview = await previewResponse.json();
  assert.equal(preview.status, "requires_user_confirmation");
  assert.equal(preview.protectedWallets.length, 1);
  assert.equal(preview.protectedWallets[0].balance, "42.50");
  assert.equal(preview.recoveryPolicy.nonZeroBalanceAction, "protected_no_delete");
  assert.equal(preview.recoveryPolicy.sweepSupported, false);

  const confirmedResponse = await post(baseUrl, `/api/v1/wallet-groups/${seeded.groupId}/wallets/batch-delete`, {
    walletIds: selectedIds,
    confirm: true,
    confirmationToken: preview.confirmationToken,
    recoveryStrategy: "archive_zero_balance_wallets",
  });
  assert.equal(confirmedResponse.status, 200);
  const confirmed = await confirmedResponse.json();
  assert.equal(confirmed.deletedWalletIds.length, 2);
  assert.equal(confirmed.protectedWalletIds.length, 1);
  const reusedConfirmation = await post(baseUrl, `/api/v1/wallet-groups/${seeded.groupId}/wallets/batch-delete`, {
    walletIds: selectedIds,
    confirm: true,
    confirmationToken: preview.confirmationToken,
    recoveryStrategy: "archive_zero_balance_wallets",
  });
  assert.equal(reusedConfirmation.status, 409);
  const remaining = await fetch(`${baseUrl}/api/v1/wallet-groups/${seeded.groupId}/wallets`).then((response) => response.json());
  assert.equal(remaining.wallets.length, 1);
  assert.equal(remaining.wallets[0].balance, "42.50");
});

test("wallet export enforces confirmation, recent reauth, MFA, audit, and remains disabled", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const groups = await fetch(`${baseUrl}/api/v1/wallet-groups`).then((response) => response.json());
  const groupId = groups.groups[0].groupId;
  const path = `/api/v1/wallet-groups/${groupId}/exports`;

  assert.equal((await post(baseUrl, path, {})).status, 400);
  assert.equal((await post(baseUrl, path, { confirmExport: true })).status, 401);
  assert.equal((await post(baseUrl, path, { confirmExport: true }, { "x-reauthenticated-at": new Date().toISOString() })).status, 403);
  const gated = await post(baseUrl, path, { confirmExport: true, reason: "User requested backup" }, {
    "x-reauthenticated-at": new Date().toISOString(),
    "x-mfa-verified": "true",
  });
  assert.equal(gated.status, 503);
  const body = await gated.json();
  assert.equal(body.error.code, "WALLET_EXPORT_DISABLED");
  assert.equal(body.error.details.privateKeyMaterialReturned, false);
  assert.doesNotMatch(JSON.stringify(body), /BEGIN PRIVATE KEY|mnemonic|seed phrase/i);
  assert.deepEqual(application.walletGroupRepository.auditEvents().map(({ outcome }) => outcome), [
    "explicit_confirmation_missing",
    "recent_reauthentication_required",
    "mfa_required",
    "export_service_disabled",
  ]);
});

test("transfer preview is idempotent and transfer submission stays planned and disabled", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const groups = await fetch(`${baseUrl}/api/v1/wallet-groups`).then((response) => response.json());
  const destination = groups.groups.find(({ name }) => name === "Research");
  const input = {
    source: { type: "login_wallet" },
    destination: { type: "wallet_group", id: destination.groupId },
    amountMode: "fraction",
    fractionBps: 2500,
    distribution: "equal",
    idempotencyKey: "transfer-test-001",
  };
  const previewResponse = await post(baseUrl, "/api/v1/transfers/preview", input);
  assert.equal(previewResponse.status, 201);
  const preview = await previewResponse.json();
  assert.equal(preview.estimatedAmount, "2105.00");
  assert.equal(preview.allocations.length, 2);
  assert.equal(preview.executionMode, "disabled");
  const replay = await post(baseUrl, "/api/v1/transfers/preview", input).then((response) => response.json());
  assert.equal(replay.previewToken, preview.previewToken);
  const conflictingPreview = await post(baseUrl, "/api/v1/transfers/preview", { ...input, fractionBps: 5000 });
  assert.equal(conflictingPreview.status, 409);

  const submitBody = {
    previewToken: preview.previewToken,
    confirmationToken: preview.confirmationToken,
    idempotencyKey: input.idempotencyKey,
  };
  assert.equal((await post(baseUrl, "/api/v1/transfers", submitBody)).status, 400);
  assert.equal((await post(baseUrl, "/api/v1/transfers", submitBody, { "Idempotency-Key": "different-key" })).status, 400);
  const submittedResponse = await post(baseUrl, "/api/v1/transfers", submitBody, { "Idempotency-Key": input.idempotencyKey });
  assert.equal(submittedResponse.status, 202);
  const transfer = await submittedResponse.json();
  assert.equal(transfer.status, "planned");
  assert.deepEqual(transfer.allowedStatuses, ["planned", "signing", "submitted", "confirmed", "failed"]);
  assert.equal(transfer.executionMode, "disabled");
  assert.equal(transfer.signingStatus, "signing_disabled");
  assert.equal(transfer.broadcastingStatus, "broadcasting_disabled");
  assert.equal(transfer.submitted, false);
  assert.equal(transfer.confirmed, false);
  assert.equal(transfer.txHash, null);
  const retry = await post(baseUrl, "/api/v1/transfers", submitBody, { "Idempotency-Key": input.idempotencyKey }).then((response) => response.json());
  assert.equal(retry.transferId, transfer.transferId);
});

test("wallet-group transfers pair wallets by index and support the login wallet in either direction", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const groups = await fetch(`${baseUrl}/api/v1/wallet-groups`).then((response) => response.json());
  const source = groups.groups[0];
  const destination = groups.groups[1];
  const groupPreview = await post(baseUrl, "/api/v1/transfers/preview", {
    source: { type: "wallet_group", id: source.groupId }, destination: { type: "wallet_group", id: destination.groupId },
    amountMode: "fraction", fractionBps: 5000, distribution: "equal", idempotencyKey: "group-pair-preview",
  });
  assert.equal(groupPreview.status, 201);
  const paired = await groupPreview.json();
  assert.equal(paired.pairingMode, "wallet_index_1_to_1");
  assert.equal(paired.pairCount, Math.min(source.walletCount, destination.walletCount));
  assert.equal(paired.allocations[0].pairIndex, 0);
  assert.ok(paired.allocations.every((item) => item.sourceWalletId && item.destinationWalletId));

  const loginDestination = await post(baseUrl, "/api/v1/transfers/preview", {
    source: { type: "wallet_group", id: source.groupId }, destination: { type: "login_wallet" },
    amountMode: "fraction", fractionBps: 2500, distribution: "equal", idempotencyKey: "group-login-preview",
  });
  assert.equal(loginDestination.status, 201);
  assert.equal((await loginDestination.json()).pairingMode, "wallet_group_to_login");
});
