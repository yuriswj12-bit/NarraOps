// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.ts";
import { createLogger } from "../src/security.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryWalletGroupRepository } from "../src/repositories/in-memory-wallet-group-repository.ts";

const testConfig = {
  bodyLimitBytes: 100_000,
  taskStepDelayMs: 5,
  sseHeartbeatMs: 1_000,
};

async function startApi(overrides = {}) {
  const application = createApplication({ config: testConfig, logger: createLogger("silent"), ...overrides });
  await new Promise((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  const { port } = application.server.address();
  return { application, baseUrl: `http://127.0.0.1:${port}` };
}

test("wallet provisioning replaces simulated references with real multi-chain public addresses", async (t) => {
  const walletProvisioningService = {
    provision: async ({ walletId }) => ({
      walletId,
      publicAddress: "0x2222222222222222222222222222222222222222",
      addresses: { bsc: "0x2222222222222222222222222222222222222222", robinhood: "0x2222222222222222222222222222222222222222", solana: "11111111111111111111111111111111" },
      signerReferences: { evm: `${walletId}:evm`, solana: `${walletId}:solana` },
      custodyMode: "narraops_encrypted_vault",
      provisioningStatus: "active",
    }),
  };
  const { application, baseUrl } = await startApi({ walletProvisioningService });
  t.after(() => application.close());
  const group = await post(baseUrl, "/api/v1/wallet-groups", { name: "Cooking Alpha", purpose: "cooking", walletCount: 1 }).then((response) => response.json());
  assert.equal(group.executionMode, "encrypted_vault");
  const result = await fetch(`${baseUrl}/api/v1/wallet-groups/${group.groupId}/wallets`).then((response) => response.json());
  assert.equal(result.mode, "encrypted_vault");
  assert.equal(result.wallets[0].provisioningStatus, "active");
  assert.equal(result.wallets[0].addresses.solana, "11111111111111111111111111111111");
  assert.doesNotMatch(JSON.stringify(result), /signerReferences|privateKey|secretKey/i);
});

test("wallet group metadata and public addresses survive an API restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "narraops-wallet-groups-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "groups.json");
  const first = new InMemoryWalletGroupRepository({ seed: false, filePath });
  const group = first.createGroup({ name: "Persistent", purpose: "cooking", walletCount: 1 });
  const wallet = first.listWallets(group.groupId)[0];
  first.activateWallet(wallet.walletId, { publicAddress: "0x2222222222222222222222222222222222222222", addresses: { bsc: "0x2222222222222222222222222222222222222222", solana: "11111111111111111111111111111111" }, signerReferences: { evm: `${wallet.walletId}:evm`, solana: `${wallet.walletId}:solana` }, custodyMode: "narraops_encrypted_vault", provisioningStatus: "active" });
  const restored = new InMemoryWalletGroupRepository({ seed: false, filePath });
  assert.equal(restored.listGroups()[0].name, "Persistent");
  assert.equal(restored.listWallets(group.groupId)[0].addresses.solana, "11111111111111111111111111111111");
  assert.doesNotMatch(JSON.stringify(restored.listWallets(group.groupId)), /signerReferences/);
});

async function post(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("wallet groups are isolated by authenticated Web3 user", async (t) => {
  const authService = {
    authenticate(cookie = "") {
      const userId = cookie.includes("user-a") ? "user-a" : cookie.includes("user-b") ? "user-b" : null;
      return userId ? { user: { userId } } : null;
    },
  };
  const walletGroupRepository = new InMemoryWalletGroupRepository({ seed: false });
  const { application, baseUrl } = await startApi({ authService, walletGroupRepository });
  t.after(() => application.close());

  assert.equal((await fetch(`${baseUrl}/api/v1/wallet-groups`)).status, 401);
  const created = await post(baseUrl, "/api/v1/wallet-groups", { name: "User A", walletCount: 1 }, { cookie: "session=user-a" });
  assert.equal(created.status, 201);
  const group = await created.json();

  const userA = await fetch(`${baseUrl}/api/v1/wallet-groups`, { headers: { cookie: "session=user-a" } }).then((response) => response.json());
  const userB = await fetch(`${baseUrl}/api/v1/wallet-groups`, { headers: { cookie: "session=user-b" } }).then((response) => response.json());
  assert.equal(userA.groups.length, 1);
  assert.equal(userB.groups.length, 0);
  assert.equal((await fetch(`${baseUrl}/api/v1/wallet-groups/${group.groupId}/wallets`, { headers: { cookie: "session=user-b" } })).status, 404);
});

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
    chain: "solana",
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
    chain: "solana",
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
    chain: "solana",
    source: { type: "wallet_group", id: source.groupId }, destination: { type: "login_wallet", address: "external-test-address" },
    amountMode: "fraction", fractionBps: 2500, distribution: "equal", idempotencyKey: "group-login-preview",
  });
  assert.equal(loginDestination.status, 201);
  assert.equal((await loginDestination.json()).pairingMode, "wallet_group_to_login");
});

test("live wallet-group transfer distributes one source wallet across all destination wallets", async (t) => {
  const walletGroupRepository = new InMemoryWalletGroupRepository({ seed: false });
  const source = walletGroupRepository.createGroup({ name: "Cooking", purpose: "cooking", walletCount: 1 });
  const destination = walletGroupRepository.createGroup({ name: "General", purpose: "general", walletCount: 3 });
  for (const wallet of walletGroupRepository.listWallets(source.groupId)) {
    walletGroupRepository.activateWallet(wallet.walletId, {
      publicAddress: `source-${wallet.walletId}`,
      addresses: { solana: `source-${wallet.walletId}` },
      signerReferences: { solana: `ref-${wallet.walletId}` },
      custodyMode: "narraops_encrypted_vault",
      provisioningStatus: "active",
    });
  }
  for (const wallet of walletGroupRepository.listWallets(destination.groupId)) {
    walletGroupRepository.activateWallet(wallet.walletId, {
      publicAddress: `dest-${wallet.walletId}`,
      addresses: { solana: `dest-${wallet.walletId}` },
      signerReferences: { solana: `ref-${wallet.walletId}` },
      custodyMode: "narraops_encrypted_vault",
      provisioningStatus: "active",
    });
  }
  const transfers = [];
  const batches = [];
  const assetService = {
    balances: async () => ({ solana: { asset: "SOL", amount: "1", atomic: "1000000000", status: "live" } }),
    transfer: async (input) => {
      transfers.push(input);
      return { status: "confirmed", txHash: `sig-test-${transfers.length}` };
    },
    transferBatch: async (input) => {
      batches.push(input);
      return input.transfers.map((transfer, index) => ({ status: "confirmed", txHash: "sig-batch-test", amount: transfer.amount, batchIndex: index }));
    },
  };
  const { application, baseUrl } = await startApi({ walletGroupRepository, assetService });
  t.after(() => application.close());

  const response = await post(baseUrl, "/api/v1/transfers/preview", {
    chain: "solana",
    source: { type: "wallet_group", id: source.groupId },
    destination: { type: "wallet_group", id: destination.groupId },
    amountMode: "fraction",
    fractionBps: 3000,
    distribution: "equal",
    idempotencyKey: "one-to-many-live-preview",
  });
  assert.equal(response.status, 201);
  const preview = await response.json();
  assert.equal(preview.pairingMode, "source_group_to_destination_group_distribution");
  assert.equal(preview.pairCount, 3);
  assert.equal(preview.allocations.length, 3);
  assert.equal(preview.estimatedAmount, "0.3");
  assert.deepEqual(preview.allocations.map(({ amount }) => amount), ["0.1", "0.1", "0.1"]);
  assert.ok(preview.allocations.every(({ sourceWalletId }) => sourceWalletId === walletGroupRepository.listWallets(source.groupId)[0].walletId));
  assert.deepEqual(preview.unmatchedDestinationWalletIds, []);

  const submitResponse = await post(baseUrl, "/api/v1/transfers", {
    previewToken: preview.previewToken,
    confirmationToken: preview.confirmationToken,
    idempotencyKey: "one-to-many-live-preview",
  }, { "idempotency-key": "one-to-many-live-preview" });
  assert.equal(submitResponse.status, 202);
  const submitted = await submitResponse.json();
  assert.equal(submitted.status, "confirmed");
  assert.equal(submitted.transactions.length, 3);
  assert.equal(transfers.length, 0);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].transfers.map(({ to }) => to), preview.allocations.map(({ to }) => to));
});

test("live wallet-group transfer collects only funded source wallets into one destination wallet", async (t) => {
  const walletGroupRepository = new InMemoryWalletGroupRepository({ seed: false });
  const source = walletGroupRepository.createGroup({ name: "General", purpose: "general", walletCount: 3 });
  const destination = walletGroupRepository.createGroup({ name: "Cooking", purpose: "cooking", walletCount: 1 });
  for (const wallet of [...walletGroupRepository.listWallets(source.groupId), ...walletGroupRepository.listWallets(destination.groupId)]) {
    walletGroupRepository.activateWallet(wallet.walletId, {
      publicAddress: `address-${wallet.walletId}`,
      addresses: { solana: `address-${wallet.walletId}` },
      signerReferences: { solana: `ref-${wallet.walletId}` },
      custodyMode: "narraops_encrypted_vault",
      provisioningStatus: "active",
    });
  }
  const fundedAddress = walletGroupRepository.listWallets(source.groupId)[0].addresses.solana;
  const transfers = [];
  const assetService = {
    balances: async ({ addresses }) => ({
      solana: addresses.solana === fundedAddress
        ? { asset: "SOL", amount: "0.035635498", atomic: "35635498", status: "live" }
        : { asset: "SOL", amount: "0", atomic: "0", status: "live" },
    }),
    transfer: async (input) => {
      transfers.push(input);
      return { status: "confirmed", txHash: `sig-collect-${transfers.length}` };
    },
  };
  const { application, baseUrl } = await startApi({ walletGroupRepository, assetService });
  t.after(() => application.close());

  const response = await post(baseUrl, "/api/v1/transfers/preview", {
    chain: "solana",
    source: { type: "wallet_group", id: source.groupId },
    destination: { type: "wallet_group", id: destination.groupId },
    amountMode: "fraction",
    fractionBps: 10000,
    distribution: "equal",
    idempotencyKey: "many-to-one-funded-preview",
  });
  assert.equal(response.status, 201);
  const preview = await response.json();
  assert.equal(preview.pairingMode, "wallet_group_collect_to_single_destination");
  assert.equal(preview.pairCount, 1);
  assert.equal(preview.allocations.length, 1);
  assert.equal(preview.allocations[0].from, fundedAddress);
  assert.equal(preview.allocations[0].amount, "0.035630498");
  assert.equal(preview.unmatchedSourceWalletIds.length, 2);

  const submitResponse = await post(baseUrl, "/api/v1/transfers", {
    previewToken: preview.previewToken,
    confirmationToken: preview.confirmationToken,
    idempotencyKey: "many-to-one-funded-preview",
  }, { "idempotency-key": "many-to-one-funded-preview" });
  assert.equal(submitResponse.status, 202);
  const submitted = await submitResponse.json();
  assert.equal(submitted.status, "confirmed");
  assert.equal(submitted.transactions.length, 1);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].from, fundedAddress);
  assert.equal(transfers[0].to, preview.allocations[0].to);
});
