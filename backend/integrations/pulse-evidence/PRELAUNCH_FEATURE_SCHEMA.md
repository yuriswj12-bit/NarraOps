# Pulse pre-launch feature schema

The outcome label (`L0`-`L4`) is evaluation-only. Reviewers and model prompts must make the feature judgment from the original narrative evidence before consulting the outcome.

Allowed ordinal values: `none`, `weak`, `medium`, `strong`, `unknown`.

| Field | Meaning |
|---|---|
| `story_clarity` | The event or story can be stated accurately in one sentence. |
| `source_traceability` | An original person, post, image, video, event, or cultural object is traceable. |
| `subject_distinctiveness` | The subject is memorable rather than a generic animal, slogan, or name. |
| `visual_hook` | The source has an immediately recognizable visual form. |
| `emotional_hook` | The source evokes a clear emotion without relying on price action. |
| `retellability` | A stranger can repeat the story without first explaining the token. |
| `remixability` | The source supports image, phrase, character, or situation remixes. |
| `identity_potential` | A community can use it as a self-description, badge, or shared belief. |
| `cultural_grounding` | The narrative connects to an existing culture, audience, or recognizable event. |
| `timing_type` | `flash_event`, `scheduled_event`, `emerging_trend`, `evergreen`, or `unknown`. |
| `originality` | The narrative differs meaningfully from already-common tokenized stories. |
| `tokenization_crowding` | Similar token narratives appear absent, limited, crowded, or unknown. |
| `association_authenticity` | `original`, `acknowledged`, `borrowed`, `misleading`, or `unknown`. |
| `extension_potential` | The story can continue after the initial post or event. |

Every reviewed record must also contain:

- `observed_facts`: claims supported directly by saved evidence.
- `agent_inferences`: interpretations that go beyond literal evidence.
- `missing_evidence`: evidence needed to increase confidence.
- `one_sentence_narrative`: concise Bitget-like explanation of the story, not price promotion.
- `prelaunch_disposition`: `reject`, `watch`, `review`, or `high_priority`.
- `review_confidence`: integer 0-100 reflecting evidence sufficiency, not predicted return.

Post-launch websites, later communities, ATH, later endorsements, licenses obtained after launch, price, volume, and holder counts are outcome/context fields and must not be used as pre-launch inputs unless their historical availability at the analysis time is proven.
