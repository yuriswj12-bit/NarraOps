#!/usr/bin/env python3
"""Produce an explainable blind v0 review from narrative evidence only."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


LEVEL = {"none": 0, "weak": 1, "medium": 2, "strong": 3, "unknown": None}
GENERIC = {"bitcoin", "water", "world cup 2026", "leo messi", "lamine yamal", "the alpha dog"}
CULTURAL = {
    "bitcoin", "juan", "troll", "buttcoin", "uranus", "nietzschean penguin",
    "leo messi", "lamine yamal", "world cup 2026", "messi bathing yamal",
}
PROJECT_WORDS = {"protocol", "capital", "finance", "pay", "layer 2", "security", "mmo", "bounties"}
ANIMAL_WORDS = {"cat", "dog", "penguin", "bull", "horse", "raccoon", "mushu", "chimera"}
EMOTION_WORDS = {
    "sad", "death", "died", "legacy", "medical", "bribe", "screaming", "gambling",
    "never give up", "scam", "arrest", "愤怒", "去世", "生病", "贿赂", "悲", "讽刺",
}
VISUAL_WORDS = ANIMAL_WORDS | {"look", "eyes", "testicle", "butt", "trollface", "logo", "map", "balcony"}
IDENTITY_WORDS = {
    "community", "bagworker", "soldiers", "home", "house", "never give up", "manifesting",
    "attention", "official", "社区", "身份", "信仰", "一起",
}
EVENT_WORDS = {"world cup", "arrest", "bathing", "bribe", "viral", "event", "世界杯", "贿赂", "发布"}
NEGATIVE_WORDS = {
    "fake", "scam", "random", "unrelated", "假项目", "硬蹭", "重复", "复刻",
    "随机", "无新意", "低质", "来源不明", "伪装",
}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def has_any(text: str, terms: set[str]) -> bool:
    return any(term in text for term in terms)


def usable_annotation(value: str) -> bool:
    if not value or len(value.strip()) < 8:
        return False
    replacement_ratio = value.count("�") / max(1, len(value))
    mojibake = any(mark in value for mark in ("ه®", "ï¼", "m€", "賵"))
    return replacement_ratio < 0.02 and not mojibake


def compact_sentence(value: str, limit: int = 120) -> str:
    value = re.sub(r"\s+", " ", value).strip(" -*#")
    if not value:
        return value
    sentence = re.split(r"[。！？\n]", value, maxsplit=1)[0].strip()
    return sentence[:limit].rstrip("，,；;：:")


def review(row: dict[str, Any]) -> dict[str, Any]:
    name = str(row.get("name") or "").strip()
    annotation = str(row.get("human_annotation") or "").strip()
    successful = [s for s in row.get("source_evidence", []) if s.get("fetch_status") == "success"]
    evidence_text = " ".join(
        f"{s.get('page_title') or ''} {s.get('relevant_excerpt') or ''}" for s in successful
    )
    text = f"{name} {annotation} {evidence_text}".casefold()
    tier = row.get("evidence_tier")

    clear_annotation = usable_annotation(annotation)
    story_clarity = "strong" if clear_annotation and len(annotation) >= 25 else "medium" if clear_annotation or successful else "weak"
    if tier == "context_only":
        traceability = "strong"
    elif tier in {"name_match", "direct_contract"}:
        traceability = "medium"
    else:
        traceability = "unknown"

    generic_name = name.casefold() in GENERIC or len(name) <= 4
    distinctive = "strong" if name.casefold() in CULTURAL or has_any(text, EMOTION_WORDS) else "medium" if not generic_name else "weak"
    visual = "strong" if has_any(text, VISUAL_WORDS) and (has_any(text, ANIMAL_WORDS) or "trollface" in text or "eyes" in text) else "medium" if has_any(text, VISUAL_WORDS) else "weak"
    emotional = "strong" if has_any(text, EMOTION_WORDS) else "medium" if any(x in text for x in ("fun", "搞笑", "低俗", "讽刺", "荒诞")) else "weak"
    retellability = story_clarity
    remixability = "strong" if name.casefold() in CULTURAL or has_any(text, VISUAL_WORDS | IDENTITY_WORDS) else "medium" if not generic_name else "weak"
    identity = "strong" if has_any(text, IDENTITY_WORDS) else "medium" if has_any(text, CULTURAL) else "weak"
    cultural = "strong" if name.casefold() in CULTURAL else "medium" if has_any(text, EVENT_WORDS | PROJECT_WORDS) else "weak"

    if has_any(text, EVENT_WORDS):
        timing = "flash_event" if "world cup" not in text and "世界杯" not in text else "scheduled_event"
    elif has_any(text, PROJECT_WORDS):
        timing = "emerging_trend"
    elif name.casefold() in CULTURAL:
        timing = "evergreen"
    else:
        timing = "unknown"

    crowded = has_any(text, {"cat", "dog", "bull", "coin", "bitcoin", "messi", "world cup", "猫", "狗", "牛", "硬蹭", "重复"})
    originality = "weak" if crowded and not has_any(text, EMOTION_WORDS) else "strong" if name.casefold() in CULTURAL or clear_annotation else "medium"
    crowding = "crowded" if crowded else "limited" if clear_annotation or successful else "unknown"

    direct = any(s.get("signals", {}).get("contract_address_match") for s in successful)
    if direct:
        authenticity = "acknowledged"
    elif tier == "context_only":
        authenticity = "borrowed"
    else:
        authenticity = "unknown"

    extension = "strong" if has_any(text, PROJECT_WORDS | IDENTITY_WORDS) else "medium" if clear_annotation or name.casefold() in CULTURAL else "weak"
    features = {
        "story_clarity": story_clarity,
        "source_traceability": traceability,
        "subject_distinctiveness": distinctive,
        "visual_hook": visual,
        "emotional_hook": emotional,
        "retellability": retellability,
        "remixability": remixability,
        "identity_potential": identity,
        "cultural_grounding": cultural,
        "timing_type": timing,
        "originality": originality,
        "tokenization_crowding": crowding,
        "association_authenticity": authenticity,
        "extension_potential": extension,
    }

    scored_fields = [
        "story_clarity", "source_traceability", "subject_distinctiveness", "visual_hook",
        "emotional_hook", "retellability", "remixability", "identity_potential",
        "cultural_grounding", "originality", "extension_potential",
    ]
    values = [LEVEL[features[field]] for field in scored_fields if LEVEL[features[field]] is not None]
    raw_score = round(sum(values) / (3 * len(values)) * 100) if values else 0
    explicit_negative = has_any(text, NEGATIVE_WORDS)
    project_only = has_any(text, PROJECT_WORDS) and emotional == "weak" and identity == "weak"
    penalty = (22 if explicit_negative else 0) + (10 if generic_name and crowded else 0) + (8 if project_only else 0)
    normalized = max(0, raw_score - penalty)

    narrative_gate = (
        LEVEL[story_clarity] >= 2
        and traceability in {"strong", "medium"}
        and max(LEVEL[visual], LEVEL[emotional], LEVEL[identity]) >= 2
    )
    amplification_gate = (
        LEVEL[originality] >= 2
        and LEVEL[remixability] >= 2
        and max(LEVEL[identity], LEVEL[extension]) >= 2
        and not explicit_negative
    )
    if narrative_gate and amplification_gate and normalized >= 68:
        disposition = "high_priority"
    elif narrative_gate and normalized >= 55:
        disposition = "review"
    elif normalized >= 40 and not explicit_negative:
        disposition = "watch"
    else:
        disposition = "reject"

    if clear_annotation:
        narrative = compact_sentence(annotation)
    elif successful:
        title = successful[0].get("page_title") or name
        narrative = f"围绕“{title}”形成的叙事；现有页面可确认主题，但原始传播起点仍需核验。"
    else:
        narrative = f"围绕“{name}”形成的内容，但当前没有足够证据还原其原始故事。"

    facts = []
    for source in successful[:2]:
        if source.get("page_title"):
            facts.append(f"可访问来源标题：{source['page_title']}")
        if source.get("signals", {}).get("contract_address_match"):
            facts.append("当前来源页面明确出现该 Token 合约地址。")
    missing = []
    if tier == "no_static_evidence":
        missing.append("缺少可读取的原始内容或背景来源。")
    if authenticity == "borrowed":
        missing.append("需要确认原始主体是否知情、认领或授权。")
    if not successful:
        missing.append("需要对 X 或其他动态社交来源进行定向核验。")

    reviewed = dict(row)
    reviewed["prelaunch_features"] = features
    reviewed["observed_facts"] = facts
    reviewed["agent_inferences"] = [
        f"原始特征分 {raw_score}/100，负面证据惩罚 {penalty}，基线分数 {normalized}/100；不代表收益预测。"
    ]
    reviewed["missing_evidence"] = missing
    reviewed["one_sentence_narrative"] = narrative
    reviewed["prelaunch_disposition"] = disposition
    reviewed["review_confidence"] = min(85, 30 + 15 * len(successful) + (20 if clear_annotation else 0))
    reviewed["baseline_score"] = normalized
    reviewed["narrative_gate"] = "pass" if narrative_gate else "fail"
    reviewed["amplification_gate"] = "pass" if amplification_gate else "fail"
    reviewed["risk_flags"] = [
        flag
        for flag, enabled in (
            ("explicit_negative_evidence", explicit_negative),
            ("generic_and_crowded", generic_name and crowded),
            ("project_without_meme_hook", project_only),
        )
        if enabled
    ]
    reviewed["review_method"] = "explainable_heuristic_v0"
    return reviewed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = [review(row) for row in load_jsonl(args.input)]
    args.output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    print(json.dumps({"rows": len(rows), "method": "explainable_heuristic_v0"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
