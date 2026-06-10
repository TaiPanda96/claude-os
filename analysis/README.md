# analysis

Phase 0 notebooks. Efficiency curve derivation, inflection point detection, quality proxy validation.

Session data in `sessions/` is gitignored — never commit real conversation content.

## Notebooks

- `efficiency_curve.ipynb` — plots quality proxy vs. ctx utilisation per session
- `inflection_detection.ipynb` — rolling regression to locate the garbage threshold

## Running

```bash
pip install jupyter pandas matplotlib scipy
jupyter notebook
```
