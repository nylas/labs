# Embedded banner fonts

Latin subsets of the nylas.com type stack, embedded as data URIs in generated
banner SVGs (external font loads are blocked inside GitHub-rendered SVGs).

| File | Family / weight | License |
|---|---|---|
| `manrope-800.woff2` | [Manrope](https://github.com/sharanda/manrope) ExtraBold | SIL OFL 1.1 |
| `inter-500.woff2` | [Inter](https://github.com/rsms/inter) Medium | SIL OFL 1.1 |
| `jbmono-400.woff2` / `jbmono-700.woff2` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) Regular / Bold | SIL OFL 1.1 |

All three are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/),
which permits redistribution and embedding. Subsets were produced with
`fonttools` (`pyftsubset … --unicodes="U+0020-007E,…"`), sourced from Google Fonts.
