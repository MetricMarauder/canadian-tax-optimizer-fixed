Canadian Tax Optimizer (FastAPI) — Fixed Optional Override Parsing
=================================================================

This build fixes an issue where fields like `cpp_employee_contrib_override`
and `ei_premiums_override` could be submitted as the literal string "None",
causing a 500 error during calculations.

Run
---
1) python -m venv .venv
2) source .venv/bin/activate   (Windows: .venv\Scripts\activate)
3) pip install -r requirements.txt
4) python app.py
5) open http://localhost:8000
