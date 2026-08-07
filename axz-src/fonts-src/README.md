# Font originals

Not committed (~49 MB). `scripts/subset-axz-fonts.mjs` needs these four files
here to rebuild the subsets. All are SIL Open Font License 1.1.

| File | Source |
|---|---|
| `NotoSansSC.ttf` | `github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC[wght].ttf` |
| `NotoSerifSC.ttf` | `github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC[wght].ttf` |
| `IBMPlexMono-Regular.ttf` | `github.com/google/fonts/raw/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf` |
| `IBMPlexMono-SemiBold.ttf` | `github.com/google/fonts/raw/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf` |

The subset output in `axz-src/fonts-out/` and `axz/fonts/` IS committed, so the
site builds and deploys without this step.
