# Pulse v0 narrative selection rules

## What the 50-sample blind test showed

- The explainable baseline separated L4 from the rest reasonably well (`L4` one-vs-rest pairwise AUC `0.83`).
- It did not reliably order L0, L1, L2, and L3. Their mean scores were close, so a single narrative score must not be presented as a probability of market success.
- Five of the top ten baseline scores were L4, but strong false positives remained. A good story is necessary for some winners, not sufficient for a winning token.
- L0 had many narratives that passed the basic story gate, but almost none passed both the story and amplification gates. This supports a staged filter rather than one total score.

## Production decision flow

### Gate 0: evidence eligibility

Reject or defer when:

- no original or contextual source can be opened;
- the only visible material is a token promotion;
- the source-token relationship is misleading;
- the narrative depends on unverifiable claims.

### Gate 1: narrative成立

Pass only when all are true:

- the story can be stated in one sentence;
- an original subject, event, post, image, video, or cultural object is traceable;
- at least one clear hook exists: visual, emotional, linguistic, or identity.

### Gate 2: amplification potential

Pass only when all are true:

- the narrative is not merely a crowded copy;
- people can repeat or remix it without explaining the token;
- it can support community identity or continued story development;
- there is no explicit fake-project, hard-clout-borrowing, or deceptive association signal.

### Pulse states

- `reject`: fails evidence eligibility or contains a strong negative signal.
- `watch`: interesting hook but insufficient evidence or amplification path.
- `review`: passes the narrative gate; requires targeted social verification.
- `high_priority`: passes both gates with adequate evidence.

## UI output

Do not expose the internal baseline score as an investment score. A Pulse card should show:

1. What happened.
2. Why it may become a meme.
3. Original evidence.
4. Relationship to the source: original, acknowledged, borrowed, misleading, or unknown.
5. Main counter-evidence and missing evidence.
6. State: Reject, Watch, Review, or High priority.
7. Evidence confidence.

## Data needed next

Only `review` and `high_priority` candidates should receive targeted X/social verification. Collect the original post, author, timestamp, visible engagement band, independent repost examples, and evidence of prior tokenization. Do not attempt to ingest the entire social platform.

The historical 200-token dataset should remain an evaluation corpus. It is not large or temporally clean enough to train a profitability model.
