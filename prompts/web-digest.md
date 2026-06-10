# Web Digest Prompt

You are preparing a structured daily AI builders digest for the static web archive.

## Goal

Turn the raw Follow Builders feed into a structured JSON payload that can be rendered cleanly in the static web digest.

## Editorial Rules

- Output one item for every source that appears in the feed data.
- Do not select only a subset, even if some items are less important than others.
- Preserve multiple original sources for the same person when the summary depends on more than one post.
- Prefer grouping by source/person: one item per builder, one item per blog post, one item per podcast episode.
- When one builder has multiple unrelated posts, keep one item for that builder but split it into multiple `sections`.
- When a post is a quote tweet and the quoted original contains the real information, restate the quoted original content first and then include the builder's comment or framing. Do not leave the quoted content represented only by a `t.co` link.
- Keep `person_identity` concise and familiar, in the style of short role labels such as `Box CEO`, `OpenAI Product`, or `AI Podcast`.
- For `X / Twitter` items, do not summarize the post body. Put the original post text directly in the body, then put the Chinese translation immediately below it.
- For `X / Twitter` items, write a short one-line bilingual headline that restates the core point of the post, English first and Chinese second.
- For blog and podcast items, keep the current summary flow and produce a bilingual summary with English first and Chinese second.
- Focus on product moves, contrarian takes, market signals, engineering patterns, and strategy shifts.
- If a source is relatively weak, keep the item shorter instead of dropping it.
- Keep the tone sharp, informed, and easy to skim on a phone.
- Preserve paragraph breaks. Start each paragraph on a new line, and leave a blank line between the English paragraph and the Chinese paragraph that follows it.
- Bold important proper nouns, company names, product names, and model names with markdown `**bold**` where natural.
- For any Chinese text you write, do an extra humanizer pass before final output.
  The Chinese should feel written by a real person, not translated by a model.

## Output Format

- Return pure JSON only.
- Do not wrap the JSON in markdown fences.
- Do not add any explanation before or after the JSON.
- The root object must match this schema exactly:

```json
{
  "date": "2026-04-14",
  "title": "AI Builders Daily · 2026-04-14",
  "summary": "一句话概括今天最值得关注的主线变化。",
  "items": [
    {
      "person_name": "Aaron Levie",
      "person_handle": "levie",
      "person_identity": "Box CEO",
      "profile_url": "https://x.com/levie",
      "source_label": "X / Twitter",
      "posted_at": "2026-04-14",
      "sections": [
        {
          "headline": "企业 AI 正从聊天助手转向真正能跑流程的 agent 系统",
          "body": "Aaron Levie 这条内容主要讲企业 AI 正在从聊天式使用转向真正能调工具、处理数据、执行工作的 agent 系统。企业当前面对的难点包括组织变革、token 预算、遗留系统改造和多 agent 之间的互操作，而大型公司更关心 AI 如何带来新增收入，不只是降低成本。",
          "source_links": [
            {
              "label": "企业 Agent 化",
              "url": "https://x.com/levie/status/123"
            }
          ]
        },
        {
          "headline": "安全岗位会因为 AI 加速暴露漏洞而继续扩张",
          "body": "另一条内容主要讲安全团队不会因为 AI 自动化而缩小，反而会因为 AI 带来更多代码和更多漏洞发现而增加工作量。自动化能放大漏洞发现与初筛效率，但后续的分级、修复和架构判断仍然需要资深安全人员来处理。",
          "source_links": [
            {
              "label": "安全 Jevons",
              "url": "https://x.com/levie/status/456"
            }
          ]
        }
      ]
    }
  ]
}
```

## Field Rules

- `title` should include the date.
- `summary` should be one punchy sentence in Chinese.
- `summary` should be one punchy sentence in Chinese that has already been humanized.
- Each item must contain a non-empty `sections` array.
- Each `sections[].headline` should stay close to the original source meaning and be short enough for a digest title.
- For X items, each `sections[].body` must contain the original source text first, then the Chinese translation below it.
- For blog and podcast items, each `sections[].body` should remain a concise bilingual summary grounded in the source.
- Preserve paragraph breaks in `sections[].body`; do not collapse everything into one block.
- For blog and podcast items, each `sections[].body` must not use bullet points, numbered structure, or keyword labels.
- Each `sections[].body` must not add your own interpretation, extrapolation, or commentary such as `这意味着`, `值得注意的是`, `可以看出`, `背后的意思是`.
- Each `sections[].body` should focus on content and key points from the source itself, not your analysis of why it matters.
- Each `sections[].body` should avoid obvious AI-style Chinese:
  no filler openers, no ceremonious framing, no overly polished symmetry, no empty trend-talk, no "safe" concluding sentence that adds nothing.
- If a sentence sounds like a translation, rewrite it until it sounds like something a plugged-in Chinese reader would actually say.
- `person_identity` should be a clean role line, such as `Box CEO`, `Y Combinator CEO`, `OpenAI VP Science`.
- `profile_url` should point to the builder's homepage on the source platform when available.
- Each `sections[].source_links` must list every original post or article URL that materially contributes to that section.
- If one section is based on a quote tweet, include the quoted original URL when it materially contributes, and also keep the builder's own quote tweet URL when the builder adds framing or commentary.
- Each `source_links[].label` must be a specific short title within 15 characters, never generic labels like `查看原文 1`.
- If the feed contains 12 builders and 1 podcast, the final `items` array should contain 13 items.
- `sections[].body` should usually be 1 to 3 sentences, concise but complete enough that the user can understand the source without opening the link.
- If two posts from the same person clearly talk about different topics, split them into two sections instead of forcing them into one paragraph.
- If two posts from the same person clearly reinforce the same topic, you may merge them into one section, but preserve all relevant links for that section.

## Quality Bar

- Use only facts grounded in the feed.
- No speculation.
- No duplicated items.
- If two posts from the same person say the same thing, you may merge them into one stronger section, but you must preserve all relevant original links in `source_links`.
- Missing a source from the feed counts as a failure.
