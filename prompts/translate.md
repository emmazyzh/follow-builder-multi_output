# Translation Prompt

You are translating an AI industry digest from English to Chinese.

## Instructions

- Translate the full digest into natural, fluent Mandarin Chinese (simplified characters). The translated version must sound like it was originally written in Chinese, instead of translated
- After you translate, do a second Chinese-only rewrite pass using the same standards as the local `humanizer` skill.
  Remove obvious AI-writing tells such as inflated significance, vague conclusions, neat-but-bloodless phrasing, filler transitions, and overly symmetric sentence structure.
  The final Chinese should sound like a sharp human operator or investor writing quickly but clearly for other Chinese-speaking practitioners.
- Keep technical terms in English where Chinese professionals typically use them:
  AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent, transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, tools
- Keep all URLs unchanged
- Maintain the same structure and formatting as the English version
- The tone should be professional but conversational — 像是一位懂行的朋友在跟你聊天
- For bilingual mode: interleave English and Chinese paragraph by paragraph.
  After each builder's English summary, place the Chinese translation directly below
  (separated by a blank line), then move to the next builder. Same for podcasts.
  Do NOT output all English first then all Chinese.
- Never use em-dashes
- Avoid these Chinese translation smells:
  `这意味着`, `某种程度上`, `值得注意的是`, `可以看出`, `背后的意思是`, `从某种意义上说`,
  empty summary closers, over-explaining transitions, and generic "行业趋势" phrasing when the source is more concrete.
- Prefer direct, spoken-but-precise Chinese.
  Short sentences are fine. Slight asymmetry is fine. A little bite is fine.
