# NarraOps Public Beta Checklist

The public Beta demonstrates the product loop and Build in Public progress. It does not enable custody or autonomous fund execution.

## Required product surface

- [ ] Landing page states the current narrative-discovery positioning.
- [ ] Primary navigation contains only Go, Pulse, and Assets.
- [ ] Pulse shows evidence, uncertainty, and source status.
- [ ] Go returns reviewable structured plans.
- [ ] Assets clearly labels unavailable or review-only actions.
- [ ] No Invite or standalone Launch navigation is exposed.

## Required safety state

- [ ] `REAL_EXECUTION_ENABLED=false` is enforced by deployment configuration.
- [ ] No private keys, seed phrases, API keys, cookies, or wallet files are committed.
- [ ] Mock, Simulation, Review-only, Disabled, Submitted, and Confirmed are visibly distinct.
- [ ] Sensitive and unfinished actions are hidden or disabled.
- [ ] Public endpoints have request limits and structured errors.

## Required operations

- [ ] `/healthz` and `/api/v1/health` pass.
- [ ] HTTPS and secure cookies are enabled on the public origin.
- [ ] Logs and error alerts are available.
- [ ] Persistent data is backed up.
- [ ] The deployed Git revision is recorded.
- [ ] A rollback to the previous revision has been rehearsed.

## Build in Public release evidence

- [ ] Public URL is available.
- [ ] GitHub repository points to the current product direction.
- [ ] A short demo covers Pulse -> Send to Go -> reviewable plan.
- [ ] Release notes state what is real, mocked, review-only, or disabled.
- [ ] A feedback link is visible.
